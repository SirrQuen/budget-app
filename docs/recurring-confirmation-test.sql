-- =====================================================================
-- Recurring confirmation test (migration 50, docs/Recurring-Confirmation.md)
--
--   npx supabase@latest db query --linked -f docs/recurring-confirmation-test.sql
--
-- To check migration 50 before it's pushed, run it inside this file's
-- transaction: put its statements right after BEGIN (everything still
-- ends in ROLLBACK).
--
-- Returns one row per assertion; a run is clean only when every `pass`
-- is true. Self-cleaning, same as docs/rls-isolation-test.sql: one
-- throwaway user, one transaction, ROLLBACK. Cleanup check (must be 0):
--   select count(*) from auth.users where email like 'rc-test-%@example.invalid';
--
-- What only the database can show. The TypeScript side (queue timing,
-- the hero not changing at the boundary, bulk counting) is pinned by
-- lib/confirmationQueue.test.ts. Here, each write is the exact row shape
-- lib/db/recurring.ts's confirmOccurrence inserts, made as the user:
--
--   1  A transfer schedule may carry date_tolerance_days (migration 50).
--   2  Reading the schedules writes nothing.
--   3  The claim: advancing next_run_date guarded on its old value
--      succeeds once; a second answer to the same occurrence finds 0 rows.
--   4  A confirmation on a changed date lands on that date and moves the
--      balance -- and counts_toward_balance_preview (what the confirm
--      sheet's note reads) agreed beforehand.
--   5  A confirmation dated before the account's balance date is allowed,
--      leaves the balance alone, and the preview said so (ruling 6).
--   6  A transfer confirmed on a changed date: both legs on that date.
--   7  Two confirmations of one schedule onto one date hit
--      recurring_tx_no_double_post (23505), which confirmOccurrence turns
--      into "already has a transaction on that date".
-- =====================================================================

begin;

create temp table rc_results (
  seq      serial primary key,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
-- Assertions are recorded while impersonating the user.
grant insert, select on rc_results to authenticated;
grant usage on sequence rc_results_seq_seq to authenticated;

create function pg_temp.rec(p_check text, p_expected text, p_actual text) returns void
language sql as $$
  insert into rc_results (check_, expected, actual, pass)
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
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'rc-test-c@example.invalid', '{}'::jsonb,
        '{"first_name": "Rc", "last_name": "Test"}'::jsonb, now(), now());

do $$
declare
  u        constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  chk      constant uuid := 'cccccccc-0000-4000-8000-000000000001';
  sav      constant uuid := 'cccccccc-0000-4000-8000-000000000002';
  rent_s   constant uuid := 'cccccccc-0000-4000-8000-000000000011';
  gym_s    constant uuid := 'cccccccc-0000-4000-8000-000000000012';
  xfer_s   constant uuid := 'cccccccc-0000-4000-8000-000000000013';
  rent_cat uuid;
  n        bigint;
  bal      numeric;
  sav_bal  numeric;
  preview  boolean;
  grp      uuid := gen_random_uuid();
  state    text;
  before_n bigint;
begin
  select id into rent_cat from public.categories where userid = u and category_name = 'Rent';

  perform pg_temp.become(u);

  -- Balance date 10 days ago; opening balance 1000.
  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (chk, u, 'RC checking', 'Checking', 1000, current_date - 10),
         (sav, u, 'RC savings',  'Savings',  0,    current_date - 10);

  -- 1 -----------------------------------------------------------------
  begin
    insert into public.recurring_transactions
      (id, userid, accountid, to_accountid, description, amount, frequency,
       next_run_date, start_date, next_due_date, date_tolerance_days)
    values (xfer_s, u, chk, sav, 'To savings', 300, 'Monthly',
            current_date - 3, current_date - 3, current_date - 3, 3);
    perform pg_temp.rec('1 transfer schedule accepts date_tolerance_days', 'accepted', 'accepted');
  exception when others then
    perform pg_temp.rec('1 transfer schedule accepts date_tolerance_days', 'accepted', sqlstate || ' ' || sqlerrm);
    -- Without migration 50: the same schedule, fixed-date, so the rest still runs.
    insert into public.recurring_transactions
      (id, userid, accountid, to_accountid, description, amount, frequency,
       next_run_date, start_date, next_due_date)
    values (xfer_s, u, chk, sav, 'To savings', 300, 'Monthly',
            current_date - 3, current_date - 3, current_date - 3);
  end;

  insert into public.recurring_transactions
    (id, userid, accountid, categoryid, description, amount, frequency,
     next_run_date, start_date, next_due_date)
  values (rent_s, u, chk, rent_cat, 'Rent', 100, 'Monthly',
          current_date - 5, current_date - 5, current_date - 5),
         (gym_s,  u, chk, rent_cat, 'Gym',  40,  'Monthly',
          current_date - 25, current_date - 25, current_date - 25);

  -- 2 -----------------------------------------------------------------
  select count(*) into before_n from public.transactions;
  perform count(*) from public.v_upcoming_recurring;
  select count(*) into n from public.transactions;
  perform pg_temp.rec('2 past-due schedules + a view read write no transaction', '0', (n - before_n)::text);
  perform pg_temp.rec('2 no transaction exists for any schedule', '0', n::text);

  -- 3 -----------------------------------------------------------------
  update public.recurring_transactions
     set next_run_date = (current_date - 5) + interval '1 month',
         next_due_date = (current_date - 5) + interval '1 month'
   where id = rent_s and next_run_date = current_date - 5;
  get diagnostics n = row_count;
  perform pg_temp.rec('3 first answer claims the occurrence', '1', n::text);

  update public.recurring_transactions
     set next_run_date = (current_date - 5) + interval '1 month'
   where id = rent_s and next_run_date = current_date - 5;
  get diagnostics n = row_count;
  perform pg_temp.rec('3 second answer to the same occurrence claims nothing', '0', n::text);

  -- 4 -----------------------------------------------------------------
  -- Rent was predicted 5 days ago; it landed 2 days ago, for 120.
  select public.counts_toward_balance_preview(chk, current_date - 2) into preview;
  perform pg_temp.rec('4 preview: a date after the balance date counts', 'true', preview::text);

  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description, recurringid)
  values (u, chk, rent_cat, 120, 'Expense', current_date - 2, 'Rent', rent_s);

  select transaction_date::text into state from public.transactions where recurringid = rent_s;
  perform pg_temp.rec('4 transaction is on the confirmed date', (current_date - 2)::text, state);
  select balance into bal from public.v_account_balances where account_id = chk;
  perform pg_temp.rec('4 balance moved by the confirmed amount', '880.00', to_char(bal, 'FM999990.00'));

  -- 5 -----------------------------------------------------------------
  -- Gym, predicted 25 days ago -- before the balance date.
  select public.counts_toward_balance_preview(chk, current_date - 25) into preview;
  perform pg_temp.rec('5 preview: a date before the balance date does not count', 'false', preview::text);

  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description, recurringid)
  values (u, chk, rent_cat, 40, 'Expense', current_date - 25, 'Gym', gym_s);
  get diagnostics n = row_count;
  perform pg_temp.rec('5 a pre-balance-date confirmation is allowed', '1', n::text);
  select balance into bal from public.v_account_balances where account_id = chk;
  perform pg_temp.rec('5 ...and leaves the balance alone, as the preview said', '880.00', to_char(bal, 'FM999990.00'));

  -- 6 -----------------------------------------------------------------
  -- Transfer predicted 3 days ago; it went yesterday.
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description, recurringid, transfer_group_id)
  values (u, chk, null, 300, 'Expense', current_date - 1, 'To savings', xfer_s, grp),
         (u, sav, null, 300, 'Income',  current_date - 1, 'To savings', xfer_s, grp);
  select count(*) into n from public.transactions
   where recurringid = xfer_s and transaction_date = current_date - 1;
  perform pg_temp.rec('6 both transfer legs on the confirmed date', '2', n::text);
  select balance into bal from public.v_account_balances where account_id = chk;
  select balance into sav_bal from public.v_account_balances where account_id = sav;
  perform pg_temp.rec('6 checking down by the transfer', '580.00', to_char(bal, 'FM999990.00'));
  perform pg_temp.rec('6 savings up by the transfer', '300.00', to_char(sav_bal, 'FM999990.00'));

  -- 7 -----------------------------------------------------------------
  begin
    insert into public.transactions (userid, accountid, categoryid, amount, transaction_type,
                                     transaction_date, description, recurringid)
    values (u, chk, rent_cat, 100, 'Expense', current_date - 2, 'Rent', rent_s);
    state := 'inserted';
  exception when others then
    state := sqlstate;
  end;
  perform pg_temp.rec('7 a second Rent on the same date is refused', '23505', state);

  perform pg_temp.unbecome();
end
$$;

select seq, check_, expected, actual, pass from rc_results order by seq;

rollback;
