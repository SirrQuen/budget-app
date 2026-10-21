-- =====================================================================
-- Goal contribution edit/delete test
--
--   npx supabase@latest db query --linked -f docs/goal-contributions-test.sql
--
-- Returns one row per assertion; a run is clean only when every `pass`
-- is true. Self-cleaning, same as docs/rls-isolation-test.sql: one
-- throwaway user, one transaction, ROLLBACK. Cleanup check (must be 0):
--   select count(*) from auth.users where email like 'gc-test-%@example.invalid';
--
-- Each write is the exact statement lib/db/goals.ts makes, as the user:
-- updateGoalContribution (update amount/date by id) and
-- deleteGoalContribution (delete by id). The goal's figures are read from
-- v_goal_progress / v_goals_summary, which is what /goals shows.
--
--   1  Three contributions (100, 200, 300 toward 1000): 600, 60.0%.
--   2  Deleting the middle one removes the row -- not hidden -- and the
--      goal recomputes: 400, 40.0%, 2 contributions.
--   3  Editing an amount (300 -> 350) recomputes: 450, 45.0%.
--   4  Editing the date alone leaves the total alone.
--   5  v_goals_summary.total_saved follows (the /goals hero figure).
-- =====================================================================

begin;

create temp table gc_results (
  seq      serial primary key,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
-- Assertions are recorded while impersonating the user.
grant insert, select on gc_results to authenticated;
grant usage on sequence gc_results_seq_seq to authenticated;

create function pg_temp.rec(p_check text, p_expected text, p_actual text) returns void
language sql as $$
  insert into gc_results (check_, expected, actual, pass)
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
        'authenticated', 'authenticated', 'gc-test-d@example.invalid', '{}'::jsonb,
        '{"first_name": "Gc", "last_name": "Test"}'::jsonb, now(), now());

do $$
declare
  u      constant uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  g      constant uuid := 'dddddddd-0000-4000-8000-000000000001';
  c1     constant uuid := 'dddddddd-0000-4000-8000-000000000011';
  c2     constant uuid := 'dddddddd-0000-4000-8000-000000000012';
  c3     constant uuid := 'dddddddd-0000-4000-8000-000000000013';
  total  numeric;
  pct    numeric;
  cnt    bigint;
  n      bigint;
  saved  numeric;
begin
  perform pg_temp.become(u);

  insert into public.goals (id, userid, goal_name, goal_type, target_amount, tracking_method)
  values (g, u, 'Japan', 'Vacation', 1000, 'Manual');

  -- 1 -----------------------------------------------------------------
  insert into public.goal_contributions (id, goalid, userid, amount, date, funding_method)
  values (c1, g, u, 100, current_date - 20, 'manual'),
         (c2, g, u, 200, current_date - 10, 'manual'),
         (c3, g, u, 300, current_date,      'manual');

  select contributed_amount, pct_complete, contribution_count into total, pct, cnt
    from public.v_goal_progress where goal_id = g;
  perform pg_temp.rec('1 three contributions: total', '600.00', to_char(total, 'FM999990.00'));
  perform pg_temp.rec('1 three contributions: percent', '60.0', pct::text);
  perform pg_temp.rec('1 three contributions: count', '3', cnt::text);

  -- 2 -----------------------------------------------------------------
  delete from public.goal_contributions where id = c2;
  get diagnostics n = row_count;
  perform pg_temp.rec('2 delete removes exactly one row', '1', n::text);

  select count(*) into n from public.goal_contributions where id = c2;
  perform pg_temp.rec('2 the middle row is gone, not hidden', '0', n::text);

  select contributed_amount, pct_complete, contribution_count into total, pct, cnt
    from public.v_goal_progress where goal_id = g;
  perform pg_temp.rec('2 after deleting the middle: total', '400.00', to_char(total, 'FM999990.00'));
  perform pg_temp.rec('2 after deleting the middle: percent', '40.0', pct::text);
  perform pg_temp.rec('2 after deleting the middle: count', '2', cnt::text);

  -- 3 -----------------------------------------------------------------
  update public.goal_contributions set amount = 350, date = current_date where id = c3;
  get diagnostics n = row_count;
  perform pg_temp.rec('3 edit updates exactly one row', '1', n::text);

  select contributed_amount, pct_complete into total, pct
    from public.v_goal_progress where goal_id = g;
  perform pg_temp.rec('3 after editing 300 -> 350: total', '450.00', to_char(total, 'FM999990.00'));
  perform pg_temp.rec('3 after editing 300 -> 350: percent', '45.0', pct::text);

  -- 4 -----------------------------------------------------------------
  update public.goal_contributions set amount = 100, date = current_date - 5 where id = c1;
  select contributed_amount into total from public.v_goal_progress where goal_id = g;
  perform pg_temp.rec('4 date-only edit: total unchanged', '450.00', to_char(total, 'FM999990.00'));

  -- 5 -----------------------------------------------------------------
  select total_saved into saved from public.v_goals_summary where userid = u;
  perform pg_temp.rec('5 v_goals_summary.total_saved follows', '450.00', to_char(saved, 'FM999990.00'));

  perform pg_temp.unbecome();
end
$$;

select seq, check_, expected, actual, pass from gc_results order by seq;

rollback;
