-- =====================================================================
-- Transfer editing and amount provenance test (migration 59,
-- docs/Recurring-Amounts-and-Transfer-Editing.md items 1a and 4)
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/transfer-edit-test.sql
--
-- Returns one row per assertion; a run is clean only when every `pass`
-- is true. Self-cleaning: two throwaway users, one transaction, ROLLBACK.
-- Cleanup check (must be 0):
--   select count(*) from auth.users where email like 'te-test-%@example.invalid';
--
-- Money is compared as numeric, never text (pg_temp.rec_num).
--
--   1  update_transfer writes both legs: amount, date, description, notes.
--   2  A failure part-way through the update leaves NEITHER leg changed.
--   3  Swapping from and to gives a correct pair: the Expense leg on the
--      new source, the Income leg on the new destination, balances right.
--   4  Moving the destination across the spendable set moves
--      spendable_cash_balance() by the amount, once.
--   5  A date between the two accounts' balance dates: the preview says
--      one leg counts and the other doesn't -- per account.
--   6  Any other update of a leg is refused (trg_transactions_transfer_pair).
--   7  Another user's account, or a group that isn't the caller's, is
--      "not found" -- nothing changes.
--   8  A recurring transfer: "just this one" leaves the schedule's amount,
--      "this and future" sets it; neither does the other.
--   9  Occurrence limits count occurrences: a transfer schedule limited to
--      3 with one confirmed occurrence (two legs) has 2 remaining.
--  10  Amount provenance in v_upcoming_recurring: fixed, your estimate
--      (schedule), average/highest of last 3.
-- =====================================================================

begin;

create temp table te_results (
  seq      serial primary key,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
grant insert, select on te_results to authenticated;
grant usage on sequence te_results_seq_seq to authenticated;

create function pg_temp.rec(p_check text, p_expected text, p_actual text) returns void
language sql as $$
  insert into te_results (check_, expected, actual, pass)
  values (p_check, p_expected, coalesce(p_actual, '<null>'), coalesce(p_expected = p_actual, false))
$$;

create function pg_temp.rec_num(p_check text, p_expected numeric, p_actual numeric) returns void
language sql as $$
  insert into te_results (check_, expected, actual, pass)
  values (p_check, p_expected::text, coalesce(p_actual::text, '<null>'), coalesce(p_expected = p_actual, false))
$$;

create function pg_temp.become(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end
$$;

create function pg_temp.unbecome() returns void language plpgsql as $$
begin
  execute 'set local role none';
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- Check 2's forced failure: raises on the Income leg's update, only while
-- te.fail_income is on. Created here (rolled back with everything else).
create function public.te_fail_income_leg() returns trigger language plpgsql as $$
begin
  if current_setting('te.fail_income', true) = 'on' and new.transaction_type = 'Income' then
    raise exception 'forced failure on the Income leg';
  end if;
  return new;
end
$$;
create trigger te_fail_income_leg before update on public.transactions
  for each row execute function public.te_fail_income_leg();

insert into auth.users (id, instance_id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'te-test-a@example.invalid', '{}'::jsonb,
        '{"first_name": "Te", "last_name": "A"}'::jsonb, now(), now()),
       ('7f7f7f7f-7f7f-4f7f-8f7f-7f7f7f7f7f7f', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'te-test-b@example.invalid', '{}'::jsonb,
        '{"first_name": "Te", "last_name": "B"}'::jsonb, now(), now());

do $$
declare
  u        constant uuid := '7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e';
  other    constant uuid := '7f7f7f7f-7f7f-4f7f-8f7f-7f7f7f7f7f7f';
  chk      constant uuid := '7e7e7e7e-0000-4000-8000-000000000001';
  sav      constant uuid := '7e7e7e7e-0000-4000-8000-000000000002';
  csh      constant uuid := '7e7e7e7e-0000-4000-8000-000000000003';
  oth_acct constant uuid := '7f7f7f7f-0000-4000-8000-000000000001';
  xfer_s   constant uuid := '7e7e7e7e-0000-4000-8000-000000000011';
  rent_s   constant uuid := '7e7e7e7e-0000-4000-8000-000000000012';
  elec_s   constant uuid := '7e7e7e7e-0000-4000-8000-000000000013';
  grp      uuid := gen_random_uuid();
  rgrp     uuid := gen_random_uuid();
  exp_cat  uuid;
  v_num    numeric;
  v_num2   numeric;
  v_text   text;
  v_text2  text;
  v_bool   boolean;
  state    text;
begin
  select id into exp_cat from public.categories
   where userid = u and category_type = 'Expense' and is_active order by category_name limit 1;

  -- The other user's account, made as them.
  perform pg_temp.become(other);
  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (oth_acct, other, 'TE other', 'Checking', 100, current_date - 30);
  perform pg_temp.unbecome();

  perform pg_temp.become(u);

  -- Checking's balance date is 30 days ago, Savings' 5 days ago.
  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (chk, u, 'TE checking', 'Checking', 1000, current_date - 30),
         (sav, u, 'TE savings',  'Savings',  0,    current_date - 5),
         (csh, u, 'TE cash',     'Cash',     0,    current_date - 30);

  -- A Checking -> Cash transfer of 100, yesterday (inside the set: no effect).
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description, transfer_group_id)
  values (u, chk, null, 100, 'Expense', current_date - 1, 'Move', grp),
         (u, csh, null, 100, 'Income',  current_date - 1, 'Move', grp);

  -- 1 -----------------------------------------------------------------
  perform public.update_transfer(grp, chk, csh, 120, current_date - 2, 'Moved', 'note');
  select count(*)::text into v_text from public.transactions
   where transfer_group_id = grp and amount = 120 and transaction_date = current_date - 2
     and description = 'Moved' and notes = 'note';
  perform pg_temp.rec('1 both legs carry the new amount, date, description, notes', '2', v_text);

  -- 2 -----------------------------------------------------------------
  perform set_config('te.fail_income', 'on', true);
  begin
    perform public.update_transfer(grp, chk, csh, 999, current_date - 3, 'Broken', null);
    state := 'no error';
  exception when others then
    state := 'raised';
  end;
  perform set_config('te.fail_income', '', true);
  perform pg_temp.rec('2 the forced failure raised', 'raised', state);
  select count(*)::text into v_text from public.transactions where transfer_group_id = grp and amount = 120;
  perform pg_temp.rec('2 neither leg changed (both still 120)', '2', v_text);

  -- 3 -----------------------------------------------------------------
  perform public.update_transfer(grp, csh, chk, 120, current_date - 2, 'Moved', 'note');
  select accountid::text into v_text from public.transactions where transfer_group_id = grp and transaction_type = 'Expense';
  perform pg_temp.rec('3 swapped: Expense leg on the new source (cash)', csh::text, v_text);
  select accountid::text into v_text from public.transactions where transfer_group_id = grp and transaction_type = 'Income';
  perform pg_temp.rec('3 swapped: Income leg on the new destination (checking)', chk::text, v_text);
  select balance into v_num from public.v_account_balances where account_id = chk;
  perform pg_temp.rec_num('3 checking up by 120 after the swap', 1120, v_num);
  select balance into v_num from public.v_account_balances where account_id = csh;
  perform pg_temp.rec_num('3 cash down by 120 after the swap', -120, v_num);
  -- Swap back for what follows.
  perform public.update_transfer(grp, chk, csh, 120, current_date - 2, 'Moved', 'note');

  -- 4 -----------------------------------------------------------------
  select public.spendable_cash_balance() into v_num;
  perform public.update_transfer(grp, chk, sav, 120, current_date - 2, 'Moved', 'note');
  select public.spendable_cash_balance() into v_num2;
  perform pg_temp.rec_num('4 Checking -> Savings: spendable cash down by 120, once', 120, v_num - v_num2);
  perform public.update_transfer(grp, chk, csh, 120, current_date - 2, 'Moved', 'note');
  select public.spendable_cash_balance() into v_num2;
  perform pg_temp.rec_num('4 back to Checking -> Cash: restored exactly', v_num, v_num2);

  -- 5 -----------------------------------------------------------------
  -- 10 days ago: after Checking's balance date (30 days), before Savings' (5 days).
  perform public.update_transfer(grp, chk, sav, 120, current_date - 10, 'Moved', 'note');
  select public.counts_toward_balance_preview(chk, current_date - 10,
           (select id from public.transactions where transfer_group_id = grp and transaction_type = 'Expense'))::text
    into v_text;
  select public.counts_toward_balance_preview(sav, current_date - 10,
           (select id from public.transactions where transfer_group_id = grp and transaction_type = 'Income'))::text
    into v_text2;
  perform pg_temp.rec('5 checking leg counts (after its balance date)', 'true', v_text);
  perform pg_temp.rec('5 savings leg does not (before its balance date): the note shows for Savings only', 'false', v_text2);

  -- 6 -----------------------------------------------------------------
  begin
    update public.transactions set amount = 1 where transfer_group_id = grp and transaction_type = 'Expense';
    state := 'updated';
  exception when others then
    state := sqlstate;
  end;
  perform pg_temp.rec('6 updating one leg directly is refused', '42501', state);

  -- 7 -----------------------------------------------------------------
  begin
    perform public.update_transfer(grp, chk, oth_acct, 120, current_date - 10, 'Moved', 'note');
    state := 'updated';
  exception when others then
    state := sqlstate;
  end;
  perform pg_temp.rec('7 another user''s account is not found', 'P0002', state);
  begin
    perform public.update_transfer(gen_random_uuid(), chk, sav, 120, current_date - 10, 'Moved', 'note');
    state := 'updated';
  exception when others then
    state := sqlstate;
  end;
  perform pg_temp.rec('7 a group that isn''t the caller''s is not found', 'P0002', state);
  select count(*)::text into v_text from public.transactions where transfer_group_id = grp and accountid = oth_acct;
  perform pg_temp.rec('7 ...and nothing moved', '0', v_text);

  -- 8 -----------------------------------------------------------------
  insert into public.recurring_transactions
    (id, userid, accountid, to_accountid, description, amount, frequency,
     next_run_date, start_date, next_due_date, occurrence_limit)
  values (xfer_s, u, chk, sav, 'To savings', 300, 'Monthly',
          current_date + 20, current_date - 10, current_date + 20, 3);
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description, recurringid, transfer_group_id)
  values (u, chk, null, 300, 'Expense', current_date - 10, 'To savings', xfer_s, rgrp),
         (u, sav, null, 300, 'Income',  current_date - 10, 'To savings', xfer_s, rgrp);

  perform public.update_transfer(rgrp, chk, sav, 320, current_date - 10, 'To savings', null, false);
  select amount into v_num from public.recurring_transactions where id = xfer_s;
  perform pg_temp.rec_num('8 just this one: schedule amount untouched', 300, v_num);
  select amount into v_num from public.transactions where transfer_group_id = rgrp and transaction_type = 'Expense';
  perform pg_temp.rec_num('8 just this one: the transfer changed', 320, v_num);

  perform public.update_transfer(rgrp, chk, sav, 350, current_date - 10, 'To savings', null, true);
  select amount into v_num from public.recurring_transactions where id = xfer_s;
  perform pg_temp.rec_num('8 this and future: schedule amount set', 350, v_num);

  -- 9 -----------------------------------------------------------------
  select occurrences_remaining::text into v_text from public.v_upcoming_recurring where recurring_id = xfer_s;
  perform pg_temp.rec('9 limit 3, one transfer confirmed (two legs): 2 remaining', '2', v_text);

  -- 10 ----------------------------------------------------------------
  insert into public.recurring_transactions
    (id, userid, accountid, categoryid, description, amount, amount_is_variable, frequency,
     next_run_date, start_date, next_due_date)
  values (rent_s, u, chk, exp_cat, 'Rent', 1850, false, 'Monthly', current_date + 5, current_date - 90, current_date + 5),
         (elec_s, u, chk, exp_cat, 'Electric', 140, true, 'Monthly', current_date + 5, current_date - 90, current_date + 5);
  select amount_basis into v_text from public.v_upcoming_recurring where recurring_id = rent_s;
  perform pg_temp.rec('10 fixed schedule: fixed', 'fixed', v_text);
  select amount_basis || '/' || forecast_basis into v_text from public.v_upcoming_recurring where recurring_id = elec_s;
  perform pg_temp.rec('10 variable, nothing supplied: your estimate both ways', 'schedule/schedule', v_text);

  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description, recurringid)
  values (u, chk, exp_cat, 120, 'Expense', current_date - 85, 'Electric', elec_s),
         (u, chk, exp_cat, 190, 'Expense', current_date - 55, 'Electric', elec_s);
  select amount_basis || '/' || forecast_basis into v_text from public.v_upcoming_recurring where recurring_id = elec_s;
  perform pg_temp.rec('10 two supplied, one above the schedule: your estimate / highest so far', 'schedule/highest_so_far', v_text);

  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description, recurringid)
  values (u, chk, exp_cat, 142, 'Expense', current_date - 25, 'Electric', elec_s);
  select amount_basis || '/' || forecast_basis into v_text from public.v_upcoming_recurring where recurring_id = elec_s;
  perform pg_temp.rec('10 three supplied: average / highest of last 3', 'average_of_3/highest_of_3', v_text);

  select amount_basis into v_text from public.v_recurring_amounts where recurring_id = xfer_s;
  perform pg_temp.rec('10 v_recurring_amounts covers transfers too: fixed', 'fixed', v_text);

  perform pg_temp.unbecome();
end
$$;

select seq, check_, expected, actual, pass from te_results order by seq;

rollback;
