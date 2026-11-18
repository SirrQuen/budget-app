-- =====================================================================
-- "Is this the same money?" outside the RLS harness (migration 69)
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/same-goal-money-repro.sql
--
-- Written 2026-11-18 for rls-isolation-test.sql rows 394-395 (2i
-- controls: same_goal_money() returned 0 for A's own matching hand
-- entry; replace_contribution_with_link() raised P0002). Question: is
-- that the harness fixture, or is the feature broken for real users?
--
-- One throwaway user, every call made AS that user (role authenticated,
-- claims set -- as PostgREST does), one transaction, ROLLBACK. It writes,
-- so it isn't --read-only: Matt runs it. Cleanup check (must be 0):
--   select count(*) from auth.users where email like 'sgm-repro-%@example.invalid';
--
--   R1  A real user's case, the way the app makes it: a $25 groceries
--       expense linked to a goal, and a $25 hand entry to the same goal
--       two days earlier. same_goal_money() must pair them (1 row) and
--       "Yes" must replace the hand entry. If R1 fails, the feature is
--       broken for real users.
--   R2  The harness's state at 2i: the same linked row after section 6
--       has edited it to $30 and moved it to another account, asked
--       about a $25 hand entry. 0 rows and P0002 are CORRECT here -- the
--       rule requires the same amount. If R2 shows 0 / P0002 while R1
--       passes, rows 394-395 are the fixture, not the feature.
--
-- Ends with a summary row: ALL PASS only when every check passed.
-- =====================================================================

begin;

create temp table sgm_results (
  seq      serial primary key,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
grant insert, select on sgm_results to authenticated;
grant usage on sequence sgm_results_seq_seq to authenticated;

create function pg_temp.rec(p_check text, p_expected text, p_actual text) returns void
language sql as $$
  insert into sgm_results (check_, expected, actual, pass)
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

-- The SQLSTATE a statement raises, or 'ok'.
create function pg_temp.state_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end
$$;

insert into auth.users (id, instance_id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('5a000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'sgm-repro-a@example.invalid', '{}'::jsonb,
        '{"first_name": "Sgm", "last_name": "Repro"}'::jsonb, now(), now());

do $$
declare
  u      constant uuid := '5a000000-0000-4000-8000-000000000001';
  chk    constant uuid := '5a000000-0000-4000-8000-000000000011';
  other  constant uuid := '5a000000-0000-4000-8000-000000000012';
  goal   constant uuid := '5a000000-0000-4000-8000-000000000021';
  tx1    constant uuid := '5a000000-0000-4000-8000-000000000031';
  tx2    constant uuid := '5a000000-0000-4000-8000-000000000032';
  hand1  constant uuid := '5a000000-0000-4000-8000-000000000041';
  hand2  constant uuid := '5a000000-0000-4000-8000-000000000042';
  groc   uuid;
  rest   uuid;
  n      bigint;
begin
  perform pg_temp.become(u);
  select id into groc from public.categories where userid = u and category_name = 'Groceries';
  select id into rest from public.categories where userid = u and category_name = 'Restaurants';

  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (chk,   u, 'SGM checking', 'Checking',   1000, current_date - 30),
         (other, u, 'SGM other',    'Investment', 0,    current_date - 30);
  insert into public.goals (id, userid, goal_name, goal_type, target_amount)
  values (goal, u, 'SGM goal', 'Custom', 500);

  -- R1 ---------------------------------------------------------------
  insert into public.transactions (id, userid, accountid, categoryid, goalid, description, amount,
                                   transaction_type, transaction_date)
  values (tx1, u, chk, groc, goal, 'SGM groceries', 25, 'Expense', current_date);
  insert into public.goal_contributions (id, userid, goalid, amount, date, funding_method)
  values (hand1, u, goal, 25, current_date - 2, 'manual');

  select count(*) into n from public.same_goal_money(tx1) where contribution_id = hand1;
  perform pg_temp.rec('R1 same_goal_money() pairs a $25 link with a $25 hand entry', '1', n::text);
  perform pg_temp.rec('R1 "Yes" (replace_contribution_with_link) succeeds', 'ok',
    pg_temp.state_of(format('select public.replace_contribution_with_link(%L, %L)', tx1, hand1)));
  select count(*) into n from public.goal_contributions where id = hand1;
  perform pg_temp.rec('R1 the hand entry is gone', '0', n::text);

  -- R2 ---------------------------------------------------------------
  insert into public.transactions (id, userid, accountid, categoryid, goalid, description, amount,
                                   transaction_type, transaction_date)
  values (tx2, u, chk, groc, goal, 'SGM groceries 2', 25, 'Expense', current_date);
  -- What harness section 6 does to A_txn before 2i runs.
  update public.transactions set amount = 30, description = 'rls edited', categoryid = rest where id = tx2;
  update public.transactions set accountid = other where id = tx2;
  insert into public.goal_contributions (id, userid, goalid, amount, date, funding_method)
  values (hand2, u, goal, 25, current_date - 2, 'manual');

  select count(*) into n from public.same_goal_money(tx2) where contribution_id = hand2;
  perform pg_temp.rec('R2 harness state: $30 link vs $25 hand entry -> no pair (correct)', '0', n::text);
  perform pg_temp.rec('R2 harness state: replace refuses (correct)', 'P0002',
    pg_temp.state_of(format('select public.replace_contribution_with_link(%L, %L)', tx2, hand2)));

  perform pg_temp.unbecome();
end
$$;

-- The summary is the last row. 6 checks are expected: fewer means the
-- script stopped early, which is NOT PASSED however many passed.
select check_ as check, expected, actual, pass
  from (select seq, check_, expected, actual, pass from sgm_results
        union all
        select 2147483647, 'SUMMARY', 'ALL PASS (6 rows, 0 false)',
               count(*) || ' rows, ' || count(*) filter (where not pass) || ' false -- '
                 || case when count(*) filter (where not pass) = 0 and count(*) = 6 then 'ALL PASS' else 'NOT PASSED' end,
               count(*) filter (where not pass) = 0 and count(*) = 6
          from sgm_results) x
 order by seq;

rollback;
