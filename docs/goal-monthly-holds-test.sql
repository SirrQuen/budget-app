-- =====================================================================
-- Goal monthly holds test (migration 57)
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/goal-monthly-holds-test.sql
--
-- Sections 1-9 were first run on a throwaway project while 57 was held
-- (2026-10-31, 19/19). 10 and 11 were added when 57 was re-derived on
-- top of 58-61 (2026-11-03).
--
-- Returns one row per assertion; a run is clean only when every `pass`
-- is true. Self-cleaning, same as docs/recurring-confirmation-test.sql:
-- throwaway users, one transaction, ROLLBACK. Cleanup check (must be 0):
--   select count(*) from auth.users where email like 'gh-test-%@example.invalid';
--
-- What only the database can show. The TypeScript side (flat after the
-- cushion, never the running-low line, per-goal cents) is pinned by
-- lib/safeToSpendProjection.test.ts.
--
--   1  still_to_set_aside = max(0, monthly target - contributed this
--      month), per goal: untouched, part-funded, over-funded.
--   2  Last month's contributions don't count toward this month.
--   3  Archived, completed, no-target (null) and zero-target goals are
--      absent.
--   4  A goal funded by a counted transfer (active, Checking -> Savings)
--      is absent: the transfer is the commitment.
--   5  Funded by a PAUSED transfer, or by one that doesn't leave the set
--      (Checking -> Cash): the target holds instead.
--   6  Deleting the funding schedule nulls only the link (userid kept),
--      and the goal's target holds again.
--   7  The composite FK: a goal can't name another user's schedule, even
--      written with RLS bypassed (23503).
--   8  RLS: another user sees none of these rows.
--   9  set_goal_funding (the recurring form's side): links one goal and
--      unlinks the rest atomically; omitted goal = "No"; refuses a
--      schedule that isn't a transfer, and another user's goal or
--      schedule (P0002 -- RLS hides them).
--  10  (59) A funding transfer with an occurrence limit counts
--      OCCURRENCES: limit 2, one confirmed (two legs) is still counted,
--      so its goal still holds nothing. Counting rows, it had ended.
--  11  The view carries production's ACL (as 61 restores it), and anon
--      can't read it.
--  12  A goal near its target holds only what's left: $950 of $1,000
--      saved, $200 a month, holds $50 -- and agrees with
--      v_goal_progress.remaining_amount, the goals page's own figure.
-- =====================================================================

begin;

create temp table gh_results (
  seq      serial primary key,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
grant insert, select on gh_results to authenticated;
grant usage on sequence gh_results_seq_seq to authenticated;

create function pg_temp.rec(p_check text, p_expected text, p_actual text) returns void
language sql as $$
  insert into gh_results (check_, expected, actual, pass)
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
        'authenticated', 'authenticated', 'gh-test-d@example.invalid', '{}'::jsonb,
        '{"first_name": "Gh", "last_name": "Test"}'::jsonb, now(), now()),
       ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'gh-test-e@example.invalid', '{}'::jsonb,
        '{"first_name": "Gh", "last_name": "Other"}'::jsonb, now(), now());

do $$
declare
  u          constant uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  other      constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  chk        constant uuid := 'dddddddd-0000-4000-8000-000000000001';
  sav        constant uuid := 'dddddddd-0000-4000-8000-000000000002';
  csh        constant uuid := 'dddddddd-0000-4000-8000-000000000003';
  o_chk      constant uuid := 'eeeeeeee-0000-4000-8000-000000000001';
  o_sav      constant uuid := 'eeeeeeee-0000-4000-8000-000000000002';
  to_sav     constant uuid := 'dddddddd-0000-4000-8000-000000000011';
  paused     constant uuid := 'dddddddd-0000-4000-8000-000000000012';
  to_cash    constant uuid := 'dddddddd-0000-4000-8000-000000000013';
  o_sched    constant uuid := 'eeeeeeee-0000-4000-8000-000000000011';
  g_plain    constant uuid := 'dddddddd-0000-4000-8000-000000000021';
  g_part     constant uuid := 'dddddddd-0000-4000-8000-000000000022';
  g_over     constant uuid := 'dddddddd-0000-4000-8000-000000000023';
  g_archived constant uuid := 'dddddddd-0000-4000-8000-000000000024';
  g_done     constant uuid := 'dddddddd-0000-4000-8000-000000000025';
  g_null     constant uuid := 'dddddddd-0000-4000-8000-000000000026';
  g_zero     constant uuid := 'dddddddd-0000-4000-8000-000000000027';
  g_funded   constant uuid := 'dddddddd-0000-4000-8000-000000000028';
  g_paused   constant uuid := 'dddddddd-0000-4000-8000-000000000029';
  g_cash     constant uuid := 'dddddddd-0000-4000-8000-000000000030';
  month_start date;
  hold        text;
  n           bigint;
  state       text;
  link_user   uuid;
  rent_cat    uuid;
  rent_s      constant uuid := 'dddddddd-0000-4000-8000-000000000014';
  lim_s       constant uuid := 'dddddddd-0000-4000-8000-000000000015';
  g_limit     constant uuid := 'dddddddd-0000-4000-8000-000000000031';
  g_near      constant uuid := 'dddddddd-0000-4000-8000-000000000032';
  grp         uuid := gen_random_uuid();
  linked      text;
begin
  perform pg_temp.become(u);
  month_start := date_trunc('month', current_date::timestamptz)::date;

  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (chk, u, 'GH checking', 'Checking', 5000, current_date - 60),
         (sav, u, 'GH savings',  'Savings',  0,    current_date - 60),
         (csh, u, 'GH cash',     'Cash',     0,    current_date - 60);

  insert into public.recurring_transactions
    (id, userid, accountid, to_accountid, description, amount, frequency,
     next_run_date, start_date, next_due_date, is_active)
  values (to_sav,  u, chk, sav, 'To savings',        200, 'Monthly', current_date + 5, current_date + 5, current_date + 5, true),
         (paused,  u, chk, sav, 'Paused to savings', 200, 'Monthly', current_date + 5, current_date + 5, current_date + 5, false),
         (to_cash, u, chk, csh, 'To cash',           200, 'Monthly', current_date + 5, current_date + 5, current_date + 5, true);

  insert into public.goals (id, userid, goal_name, goal_type, target_amount, monthly_contribution, is_active, funding_recurringid)
  values (g_plain,    u, 'Plain',    'Vacation', 5000, 200,  true,  null),
         (g_part,     u, 'Part',     'Vacation', 5000, 200,  true,  null),
         (g_over,     u, 'Over',     'Vacation', 5000, 100,  true,  null),
         (g_archived, u, 'Archived', 'Vacation', 5000, 200,  false, null),
         (g_done,     u, 'Done',     'Vacation', 100,  200,  true,  null),
         (g_null,     u, 'No target','Vacation', 5000, null, true,  null),
         (g_zero,     u, 'Zero',     'Vacation', 5000, 0,    true,  null),
         (g_funded,   u, 'Funded',   'Vacation', 5000, 200,  true,  to_sav),
         (g_paused,   u, 'Paused',   'Vacation', 5000, 200,  true,  paused),
         (g_cash,     u, 'To cash',  'Vacation', 5000, 200,  true,  to_cash);

  -- The exact shape contributeToGoal() inserts.
  insert into public.goal_contributions (userid, goalid, amount, date, funding_method)
  values (u, g_part, 150,  month_start,     'manual'),
         (u, g_part, 500,  month_start - 1, 'manual'),   -- last month
         (u, g_over, 300,  month_start,     'manual'),
         (u, g_done, 100,  month_start - 1, 'manual');   -- completes it (migration 53)

  -- 1, 2 ---------------------------------------------------------------
  select still_to_set_aside::text into hold from public.v_goal_monthly_holds where goalid = g_plain;
  perform pg_temp.rec('1 untouched goal holds its whole monthly target', '200', hold);
  select still_to_set_aside::text into hold from public.v_goal_monthly_holds where goalid = g_part;
  perform pg_temp.rec('1/2 part-funded this month holds the rest (last month''s 500 not counted)', '50', hold);
  select still_to_set_aside::text into hold from public.v_goal_monthly_holds where goalid = g_over;
  perform pg_temp.rec('1 over-funded this month holds 0, never negative', '0', hold);

  -- 3 ------------------------------------------------------------------
  select count(*) into n from public.v_goal_monthly_holds
   where goalid in (g_archived, g_done, g_null, g_zero);
  perform pg_temp.rec('3 archived, completed, null and zero targets are absent', '0', n::text);
  select count(*) into n from public.goals where id = g_done and completed_at is not null;
  perform pg_temp.rec('3 (fixture) the completed goal is completed', '1', n::text);

  -- 4, 5 ---------------------------------------------------------------
  select count(*) into n from public.v_goal_monthly_holds where goalid = g_funded;
  perform pg_temp.rec('4 funded by a counted transfer: absent', '0', n::text);
  select still_to_set_aside::text into hold from public.v_goal_monthly_holds where goalid = g_paused;
  perform pg_temp.rec('5 funded by a paused transfer: the target holds', '200', hold);
  select still_to_set_aside::text into hold from public.v_goal_monthly_holds where goalid = g_cash;
  perform pg_temp.rec('5 funded by Checking -> Cash (not leaving the set): the target holds', '200', hold);

  -- 6 ------------------------------------------------------------------
  delete from public.recurring_transactions where id = to_sav;
  select funding_recurringid::text, userid into hold, link_user from public.goals where id = g_funded;
  perform pg_temp.rec('6 deleting the schedule nulls the link', '<null>', coalesce(hold, '<null>'));
  perform pg_temp.rec('6 ... and keeps userid', u::text, link_user::text);
  select still_to_set_aside::text into hold from public.v_goal_monthly_holds where goalid = g_funded;
  perform pg_temp.rec('6 ... and the goal''s target holds again', '200', hold);

  perform pg_temp.unbecome();

  -- 7 ------------------------------------------------------------------
  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (o_chk, other, 'Other checking', 'Checking', 100, current_date - 60),
         (o_sav, other, 'Other savings',  'Savings',  0,   current_date - 60);
  insert into public.recurring_transactions
    (id, userid, accountid, to_accountid, description, amount, frequency,
     next_run_date, start_date, next_due_date)
  values (o_sched, other, o_chk, o_sav, 'Other to savings', 50, 'Monthly',
          current_date + 5, current_date + 5, current_date + 5);
  begin
    -- As the table owner: RLS bypassed, so only the FK can refuse it.
    update public.goals set funding_recurringid = o_sched where id = g_plain;
    state := 'accepted';
  exception when others then
    state := sqlstate;
  end;
  perform pg_temp.rec('7 a goal can''t name another user''s schedule (composite FK)', '23503', state);

  -- 8 ------------------------------------------------------------------
  perform pg_temp.become(other);
  select count(*) into n from public.v_goal_monthly_holds where userid = u;
  perform pg_temp.rec('8 another user sees none of the holds', '0', n::text);
  perform pg_temp.unbecome();

  -- 9 ------------------------------------------------------------------
  select id into rent_cat from public.categories where userid = u and category_name = 'Rent';
  perform pg_temp.become(u);
  insert into public.recurring_transactions
    (id, userid, accountid, categoryid, description, amount, frequency,
     next_run_date, start_date, next_due_date)
  values (rent_s, u, chk, rent_cat, 'Rent', 900, 'Monthly', current_date + 5, current_date + 5, current_date + 5);

  -- to_cash funds g_cash (fixture); pointing it at g_plain moves the link.
  perform public.set_goal_funding(to_cash, g_plain);
  select string_agg(goal_name, ', ' order by goal_name) into linked from public.goals where funding_recurringid = to_cash;
  perform pg_temp.rec('9 linking a schedule to a goal moves it there, off the other', 'Plain', linked);

  perform public.set_goal_funding(to_cash);
  select count(*) into n from public.goals where funding_recurringid = to_cash;
  perform pg_temp.rec('9 no goal = "No": the schedule funds nothing', '0', n::text);

  begin
    perform public.set_goal_funding(rent_s, g_plain);
    state := 'accepted';
  exception when others then
    state := sqlstate;
  end;
  perform pg_temp.rec('9 an expense schedule can''t fund a goal', 'P0002', state);

  begin
    perform public.set_goal_funding(o_sched, g_plain);
    state := 'accepted';
  exception when others then
    state := sqlstate;
  end;
  perform pg_temp.rec('9 another user''s schedule is refused', 'P0002', state);
  perform pg_temp.unbecome();

  perform pg_temp.become(other);
  begin
    perform public.set_goal_funding(o_sched, g_plain);
    state := 'accepted';
  exception when others then
    state := sqlstate;
  end;
  perform pg_temp.rec('9 another user''s goal is refused', 'P0002', state);
  perform pg_temp.unbecome();
  select coalesce(funding_recurringid::text, '<null>') into hold from public.goals where id = g_plain;
  perform pg_temp.rec('9 ... and left it unlinked', '<null>', hold);

  -- 10 -----------------------------------------------------------------
  perform pg_temp.become(u);
  insert into public.recurring_transactions
    (id, userid, accountid, to_accountid, description, amount, frequency,
     next_run_date, start_date, next_due_date, occurrence_limit)
  values (lim_s, u, chk, sav, 'Two to savings', 200, 'Monthly',
          current_date + 5, current_date - 26, current_date + 5, 2);
  -- One confirmed occurrence: two legs, the shape confirmOccurrence writes.
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description, recurringid, transfer_group_id)
  values (u, chk, null, 200, 'Expense', current_date - 26, 'Two to savings', lim_s, grp),
         (u, sav, null, 200, 'Income',  current_date - 26, 'Two to savings', lim_s, grp);
  insert into public.goals (id, userid, goal_name, goal_type, target_amount, monthly_contribution, is_active, funding_recurringid)
  values (g_limit, u, 'Limited', 'Vacation', 5000, 200, true, lim_s);
  select occurrences_remaining::text into hold from public.v_upcoming_recurring where recurring_id = lim_s;
  perform pg_temp.rec('10 (fixture) limit 2, one confirmed: one occurrence left', '1', hold);
  select count(*) into n from public.v_goal_monthly_holds where goalid = g_limit;
  perform pg_temp.rec('10 its goal is still funded by it: absent from the holds', '0', n::text);

  -- 12 -----------------------------------------------------------------
  insert into public.goals (id, userid, goal_name, goal_type, target_amount, monthly_contribution, is_active)
  values (g_near, u, 'Near', 'Emergency Fund', 1000, 200, true);
  insert into public.goal_contributions (userid, goalid, amount, date, funding_method)
  values (u, g_near, 950, month_start - 1, 'manual');   -- last month: none this month
  select (still_to_set_aside = 50)::text into hold from public.v_goal_monthly_holds where goalid = g_near;
  perform pg_temp.rec('12 $50 from its target, $200 a month: holds $50', 'true', hold);
  select (h.still_to_set_aside = p.remaining_amount)::text into hold
    from public.v_goal_monthly_holds h join public.v_goal_progress p on p.goal_id = h.goalid
   where h.goalid = g_near;
  perform pg_temp.rec('12 ... the same figure the goals page shows as left', 'true', hold);
  select (still_to_set_aside = 200)::text into hold from public.v_goal_monthly_holds where goalid = g_plain;
  perform pg_temp.rec('12 a goal far from its target still holds its monthly amount', 'true', hold);
  perform pg_temp.unbecome();
end
$$;

-- 11 -------------------------------------------------------------------
select pg_temp.rec('11 v_goal_monthly_holds ACL',
                   'postgres=arwdDxtm/postgres authenticated=rDxtm/postgres service_role=Dxtm/postgres',
                   (select array_to_string(relacl, ' ') from pg_class where oid = 'public.v_goal_monthly_holds'::regclass));
select pg_temp.rec('11 anon cannot read v_goal_monthly_holds', 'false',
                   has_table_privilege('anon', 'public.v_goal_monthly_holds', 'select')::text);
select pg_temp.rec('11 v_goal_monthly_holds is security_invoker', 'security_invoker=true',
                   (select array_to_string(reloptions, ',') from pg_class where oid = 'public.v_goal_monthly_holds'::regclass));

select seq, check_, expected, actual, pass from gh_results order by seq;

rollback;
