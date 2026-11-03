-- =====================================================================
-- Expense estimate test (migration 58, docs/Recurring-Amounts-and-
-- Transfer-Editing.md item 1b)
--
--   npx supabase db query --remote -f docs/expense-estimate-test.sql
--
-- Returns one row per assertion; a run is clean only when every `pass`
-- is true. Self-cleaning, same as docs/recurring-confirmation-test.sql:
-- one throwaway user, one transaction, ROLLBACK. Cleanup check (must be 0):
--   select count(*) from auth.users where email like 'ee-test-%@example.invalid';
--
-- The TypeScript side (the projection counting amount_high, the
-- is_estimated rule for each answer, the caution line) is pinned by
-- lib/safeToSpendProjection.test.ts, lib/confirmationQueue.test.ts and
-- lib/whatsAhead.test.ts. Here, what only the database can show:
--
--   1  A variable bill of 120, 190, 142: the view shows the mean (150.67)
--      as `amount` and the max (190) as `amount_high`.
--   2  An is_estimated row (a one-tap confirm, or the old catch-up) is
--      left out of both: a 400 guess moves neither.
--   3  Below three supplied amounts: amount_high is the greater of the
--      schedule's amount and anything supplied; `amount` is the schedule's.
--   4  Variable income: amount_low skips is_estimated rows the same way.
--   5  A fixed schedule has no amount_high.
--   6  Editing a row's amount clears is_estimated; editing only its
--      description doesn't.
-- =====================================================================

begin;

create temp table ee_results (
  seq      serial primary key,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
grant insert, select on ee_results to authenticated;
grant usage on sequence ee_results_seq_seq to authenticated;

create function pg_temp.rec(p_check text, p_expected text, p_actual text) returns void
language sql as $$
  insert into ee_results (check_, expected, actual, pass)
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
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'ee-test-e@example.invalid', '{}'::jsonb,
        '{"first_name": "Ee", "last_name": "Test"}'::jsonb, now(), now());

do $$
declare
  u         constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  chk       constant uuid := 'eeeeeeee-0000-4000-8000-000000000001';
  elec_s    constant uuid := 'eeeeeeee-0000-4000-8000-000000000011';
  water_s   constant uuid := 'eeeeeeee-0000-4000-8000-000000000012';
  pay_s     constant uuid := 'eeeeeeee-0000-4000-8000-000000000013';
  rent_s    constant uuid := 'eeeeeeee-0000-4000-8000-000000000014';
  exp_cat   uuid;
  inc_cat   uuid;
  tx_id     uuid;
  v_amount  numeric;
  v_high    numeric;
  v_low     numeric;
  flag      boolean;
begin
  select id into exp_cat from public.categories
   where userid = u and category_type = 'Expense' and is_active order by category_name limit 1;
  select id into inc_cat from public.categories
   where userid = u and category_type = 'Income' and is_active order by category_name limit 1;

  perform pg_temp.become(u);

  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (chk, u, 'EE checking', 'Checking', 5000, current_date - 200);

  insert into public.recurring_transactions
    (id, userid, accountid, categoryid, description, amount, amount_is_variable,
     frequency, next_run_date, start_date, next_due_date)
  values (elec_s,  u, chk, exp_cat, 'Electric', 140, true,  'Monthly', current_date + 5, current_date - 150, current_date + 5),
         (water_s, u, chk, exp_cat, 'Water',    60,  true,  'Monthly', current_date + 5, current_date - 150, current_date + 5),
         (pay_s,   u, chk, inc_cat, 'Pay',      1500, true, 'Monthly', current_date + 5, current_date - 150, current_date + 5),
         (rent_s,  u, chk, exp_cat, 'Rent',     1850, false, 'Monthly', current_date + 5, current_date - 150, current_date + 5);

  -- 1 -----------------------------------------------------------------
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description, recurringid)
  values (u, chk, exp_cat, 120, 'Expense', current_date - 90, 'Electric', elec_s),
         (u, chk, exp_cat, 190, 'Expense', current_date - 60, 'Electric', elec_s),
         (u, chk, exp_cat, 142, 'Expense', current_date - 30, 'Electric', elec_s);
  select amount, amount_high into v_amount, v_high from public.v_upcoming_recurring where recurring_id = elec_s;
  perform pg_temp.rec('1 amount is the mean of the last three', '150.67', v_amount::text);
  perform pg_temp.rec('1 amount_high is the max of the last three', '190', v_high::text);

  -- 2 -----------------------------------------------------------------
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description, recurringid, is_estimated)
  values (u, chk, exp_cat, 400, 'Expense', current_date - 1, 'Electric', elec_s, true)
  returning id into tx_id;
  select amount, amount_high into v_amount, v_high from public.v_upcoming_recurring where recurring_id = elec_s;
  perform pg_temp.rec('2 an estimated row leaves the mean alone', '150.67', v_amount::text);
  perform pg_temp.rec('2 an estimated row leaves the high alone', '190', v_high::text);

  -- 3 -----------------------------------------------------------------
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description, recurringid)
  values (u, chk, exp_cat, 75, 'Expense', current_date - 30, 'Water', water_s);
  select amount, amount_high into v_amount, v_high from public.v_upcoming_recurring where recurring_id = water_s;
  perform pg_temp.rec('3 below three: amount is the schedule''s', '60', v_amount::text);
  perform pg_temp.rec('3 below three: amount_high is the greater of schedule and supplied', '75', v_high::text);

  -- 4 -----------------------------------------------------------------
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description, recurringid, is_estimated)
  values (u, chk, inc_cat, 1400, 'Income', current_date - 90, 'Pay', pay_s, false),
         (u, chk, inc_cat, 1600, 'Income', current_date - 60, 'Pay', pay_s, false),
         (u, chk, inc_cat, 1500, 'Income', current_date - 30, 'Pay', pay_s, false),
         (u, chk, inc_cat, 900,  'Income', current_date - 1,  'Pay', pay_s, true);
  select amount_low, amount_high into v_low, v_high from public.v_upcoming_recurring where recurring_id = pay_s;
  perform pg_temp.rec('4 amount_low skips the estimated 900', '1400', v_low::text);
  perform pg_temp.rec('4 income has no amount_high', '<null>', coalesce(v_high::text, '<null>'));

  -- 5 -----------------------------------------------------------------
  select amount, amount_high into v_amount, v_high from public.v_upcoming_recurring where recurring_id = rent_s;
  perform pg_temp.rec('5 fixed schedule: amount is its own', '1850', v_amount::text);
  perform pg_temp.rec('5 fixed schedule: no amount_high', '<null>', coalesce(v_high::text, '<null>'));

  -- 6 -----------------------------------------------------------------
  update public.transactions set description = 'Electric (Oct)' where id = tx_id;
  select is_estimated into flag from public.transactions where id = tx_id;
  perform pg_temp.rec('6 editing the description leaves it estimated', 'true', flag::text);

  update public.transactions set amount = 400 where id = tx_id;
  select is_estimated into flag from public.transactions where id = tx_id;
  perform pg_temp.rec('6 resaving the same amount leaves it estimated', 'true', flag::text);

  update public.transactions set amount = 212.40 where id = tx_id;
  select is_estimated into flag from public.transactions where id = tx_id;
  perform pg_temp.rec('6 changing the amount makes it a person''s figure', 'false', flag::text);

  select amount_high into v_high from public.v_upcoming_recurring where recurring_id = elec_s;
  perform pg_temp.rec('6 ...which now counts: high of 190, 142, 212.40', '212.40', v_high::text);

  perform pg_temp.unbecome();
end
$$;

select seq, check_, expected, actual, pass from ee_results order by seq;

rollback;
