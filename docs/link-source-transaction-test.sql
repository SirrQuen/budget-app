-- =====================================================================
-- "Make recurring": the source is the first occurrence (migration 60)
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/link-source-transaction-test.sql
--
-- To check migration 60 before it's pushed, paste its statements right
-- after BEGIN (everything still ends in ROLLBACK).
--
-- One row per assertion; clean only when every `pass` is true. Two
-- throwaway users, one transaction, ROLLBACK. Cleanup check (must be 0):
--   select count(*) from auth.users where email like 'ls-test-%@example.invalid';
--
--   1  A linked expense carries the schedule's recurringid, counts as one
--      occurrence, and feeds the estimate (supplied: is_estimated false).
--   2  Confirming that occurrence again on the same date is refused by
--      recurring_tx_no_double_post -- the pair is now visible to it.
--   3  A transfer links both legs, through the transfer gate, as one
--      occurrence.
--   4  A source on another account, or of the other direction, is not
--      linked (returns false, writes nothing).
--   5  An already-linked source is refused.
--   6  Another user can't link -- or see -- this user's transaction.
-- =====================================================================

begin;

create temp table ls_results (
  seq      serial primary key,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
grant insert, select on ls_results to authenticated;
grant usage on sequence ls_results_seq_seq to authenticated;

create function pg_temp.rec(p_check text, p_expected text, p_actual text) returns void
language sql as $$
  insert into ls_results (check_, expected, actual, pass)
  values (p_check, p_expected, coalesce(p_actual, '<null>'), coalesce(p_expected = p_actual, false))
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

insert into auth.users (id, instance_id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'ls-test-d@example.invalid', '{}'::jsonb,
        '{"first_name": "Ls", "last_name": "Test"}'::jsonb, now(), now()),
       ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'ls-test-e@example.invalid', '{}'::jsonb,
        '{"first_name": "Ls", "last_name": "Other"}'::jsonb, now(), now());

do $$
declare
  u        constant uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  other    constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  chk      constant uuid := 'dddddddd-0000-4000-8000-000000000001';
  sav      constant uuid := 'dddddddd-0000-4000-8000-000000000002';
  chk2     constant uuid := 'dddddddd-0000-4000-8000-000000000003';
  rent_s   constant uuid := 'dddddddd-0000-4000-8000-000000000011';
  xfer_s   constant uuid := 'dddddddd-0000-4000-8000-000000000012';
  rent_tx  constant uuid := 'dddddddd-0000-4000-8000-000000000021';
  other_tx constant uuid := 'dddddddd-0000-4000-8000-000000000022';
  inc_tx   constant uuid := 'dddddddd-0000-4000-8000-000000000023';
  leg_out  constant uuid := 'dddddddd-0000-4000-8000-000000000024';
  leg_in   constant uuid := 'dddddddd-0000-4000-8000-000000000025';
  grp      constant uuid := 'dddddddd-0000-4000-8000-000000000031';
  rent_cat uuid;
  pay_cat  uuid;
  ok       boolean;
  n        bigint;
  state    text;
begin
  select id into rent_cat from public.categories where userid = u and category_name = 'Rent';
  select id into pay_cat  from public.categories where userid = u and category_name = 'Paychecks/Salary';

  perform pg_temp.become(u);

  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (chk,  u, 'LS checking', 'Checking', 1000, current_date - 60),
         (sav,  u, 'LS savings',  'Savings',  0,    current_date - 60),
         (chk2, u, 'LS second',   'Checking', 0,    current_date - 60);

  -- Hand-entered rows: is_estimated takes its default (a person's amount).
  insert into public.transactions (id, userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description)
  values (rent_tx,  u, chk,  rent_cat, 1850, 'Expense', current_date - 30, 'Rent'),
         (other_tx, u, chk2, rent_cat, 1850, 'Expense', current_date - 30, 'Rent elsewhere'),
         (inc_tx,   u, chk,  pay_cat,  1850, 'Income',  current_date - 30, 'Refund');
  insert into public.transactions (id, userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description, transfer_group_id)
  values (leg_out, u, chk, null, 200, 'Expense', current_date - 10, 'To savings', grp),
         (leg_in,  u, sav, null, 200, 'Income',  current_date - 10, 'To savings', grp);

  -- The schedules "Make recurring" creates: first date one cycle after the source.
  insert into public.recurring_transactions
    (id, userid, accountid, categoryid, description, amount, frequency,
     next_run_date, start_date, next_due_date, amount_is_variable)
  values (rent_s, u, chk, rent_cat, 'Rent', 1850, 'Monthly',
          current_date - 30 + 30, current_date - 30, current_date - 30 + 30, true);
  insert into public.recurring_transactions
    (id, userid, accountid, to_accountid, description, amount, frequency,
     next_run_date, start_date, next_due_date)
  values (xfer_s, u, chk, sav, 'To savings', 200, 'Monthly',
          current_date + 20, current_date - 10, current_date + 20);

  -- 4 (first, while nothing is linked) ---------------------------------
  select public.link_transaction_to_schedule(other_tx, rent_s) into ok;
  perform pg_temp.rec('4 a source on another account is not linked', 'false', ok::text);
  select public.link_transaction_to_schedule(inc_tx, rent_s) into ok;
  perform pg_temp.rec('4 a source of the other direction is not linked', 'false', ok::text);
  select public.link_transaction_to_schedule(leg_out, rent_s) into ok;
  perform pg_temp.rec('4 a transfer is not linked to a category schedule', 'false', ok::text);
  select public.link_transaction_to_schedule(rent_tx, xfer_s) into ok;
  perform pg_temp.rec('4 a single row is not linked to a transfer schedule', 'false', ok::text);
  select count(*) into n from public.transactions where recurringid is not null;
  perform pg_temp.rec('4 ...and none of those wrote anything', '0', n::text);

  -- 6 -----------------------------------------------------------------
  perform pg_temp.unbecome();
  perform pg_temp.become(other);
  begin
    perform public.link_transaction_to_schedule(rent_tx, rent_s);
    state := 'linked';
  exception when others then
    state := sqlstate;
  end;
  perform pg_temp.rec('6 another user cannot link this user''s transaction', 'P0002', state);
  perform pg_temp.unbecome();
  perform pg_temp.become(u);
  select count(*) into n from public.transactions where id = rent_tx and recurringid is not null;
  perform pg_temp.rec('6 ...and it stayed unlinked', '0', n::text);

  -- 1 -----------------------------------------------------------------
  select public.link_transaction_to_schedule(rent_tx, rent_s) into ok;
  perform pg_temp.rec('1 the source is linked', 'true', ok::text);
  select recurringid::text into state from public.transactions where id = rent_tx;
  perform pg_temp.rec('1 it carries the schedule''s recurringid', rent_s::text, state);
  select count(distinct coalesce(t.transfer_group_id, t.id)) into n
    from public.transactions t where t.recurringid = rent_s;
  perform pg_temp.rec('1 it counts as one occurrence', '1', n::text);
  select (not is_estimated)::text into state from public.transactions where id = rent_tx;
  perform pg_temp.rec('1 it is a supplied amount (is_estimated false)', 'true', state);
  -- With one supplied row (below three) the high estimate is greatest(stated, supplied).
  -- Compared as numeric, not text (scale varies; see the findings).
  select (public.estimate_expense_amount_high(rent_s, 1000) = 1850)::text into state;
  perform pg_temp.rec('1 the estimate reads it (high of 1000 stated vs 1850 supplied)', 'true', state);

  -- 2 -----------------------------------------------------------------
  begin
    insert into public.transactions (userid, accountid, categoryid, amount, transaction_type,
                                     transaction_date, description, recurringid)
    values (u, chk, rent_cat, 1850, 'Expense', current_date - 30, 'Rent', rent_s);
    state := 'inserted';
  exception when others then
    state := sqlstate;
  end;
  perform pg_temp.rec('2 confirming the source''s date again is refused', '23505', state);

  -- 5 -----------------------------------------------------------------
  begin
    perform public.link_transaction_to_schedule(rent_tx, rent_s);
    state := 'linked';
  exception when others then
    state := sqlstate;
  end;
  perform pg_temp.rec('5 an already-linked source is refused', '23514', state);

  -- 3 -----------------------------------------------------------------
  select public.link_transaction_to_schedule(leg_in, xfer_s) into ok;
  perform pg_temp.rec('3 a transfer links from either leg', 'true', ok::text);
  select count(*) into n from public.transactions where recurringid = xfer_s;
  perform pg_temp.rec('3 both legs carry the recurringid', '2', n::text);
  select count(distinct coalesce(transfer_group_id, id)) into n
    from public.transactions where recurringid = xfer_s;
  perform pg_temp.rec('3 ...as one occurrence', '1', n::text);
  -- The gate closed again: a plain leg update is still refused.
  begin
    update public.transactions set description = 'x' where id = leg_out;
    state := 'updated';
  exception when others then
    state := sqlstate;
  end;
  perform pg_temp.rec('3 the transfer gate is closed afterwards', '42501', state);

  perform pg_temp.unbecome();
end
$$;

select seq, check_, expected, actual, pass from ls_results order by seq;

rollback;
