-- =====================================================================
-- Goal completion test (migration 53, docs/Goal-Completion.md, D)
--
--   npx supabase@latest db query --linked -f docs/goal-completion-test.sql
--
-- To check migration 53 before it's pushed, run it inside this file's
-- transaction: put its statements right after BEGIN (everything still
-- ends in ROLLBACK).
--
-- Returns one row per assertion; a run is clean only when every `pass`
-- is true. Self-cleaning: one throwaway user, one transaction, ROLLBACK.
-- Cleanup check (must be 0):
--   select count(*) from auth.users where email like 'gc-test-%@example.invalid';
--
-- Every write is made as the user, the shape lib/db/goals.ts writes:
--
--   1  A goal below target has no completed_at.
--   2  The contribution that reaches the target sets it.
--   3  Another contribution keeps the first completion's timestamp.
--   4  Deleting the completing contribution clears it.
--   5  Editing a contribution up to the target sets it again.
--   6  Raising the target above the total clears it; lowering it back
--      to the total sets it.
--   7  A client can't write completed_at: the trigger re-derives it.
--   8  Archiving (is_active = false) keeps the contributions, and
--      v_goals_summary's total_saved stops counting the goal.
--   9  Deleting a goal cascades its contributions without an error from
--      the contribution trigger.
--  10  Reading the goal and the summary writes nothing (updated_at
--      unchanged).
-- =====================================================================

begin;

create temp table gc_results (
  seq      serial primary key,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
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
  g2     constant uuid := 'dddddddd-0000-4000-8000-000000000002';
  c1     constant uuid := 'dddddddd-0000-4000-8000-000000000011';
  c2     constant uuid := 'dddddddd-0000-4000-8000-000000000012';
  c3     constant uuid := 'dddddddd-0000-4000-8000-000000000013';
  first_at timestamptz;
  at_    timestamptz;
  saved  numeric;
  upd    timestamptz;
  state  text;
begin
  perform pg_temp.become(u);

  insert into public.goals (id, userid, goal_name, goal_type, target_amount, tracking_method)
  values (g, u, 'Laptop', 'Custom', 1000, 'Manual');

  insert into public.goal_contributions (id, goalid, userid, amount, date, funding_method)
  values (c1, g, u, 600, current_date - 3, 'manual');
  select completed_at into at_ from public.goals where id = g;
  perform pg_temp.rec('1 below target: no completed_at', '<null>', at_::text);

  insert into public.goal_contributions (id, goalid, userid, amount, date, funding_method)
  values (c2, g, u, 400, current_date, 'manual');
  select completed_at into first_at from public.goals where id = g;
  perform pg_temp.rec('2 reaching the target sets completed_at', 'true', (first_at is not null)::text);

  insert into public.goal_contributions (id, goalid, userid, amount, date, funding_method)
  values (c3, g, u, 50, current_date, 'manual');
  select completed_at into at_ from public.goals where id = g;
  perform pg_temp.rec('3 another contribution keeps the first timestamp', first_at::text, at_::text);

  delete from public.goal_contributions where id in (c2, c3);
  select completed_at into at_ from public.goals where id = g;
  perform pg_temp.rec('4 deleting the completing contribution clears it', '<null>', at_::text);

  update public.goal_contributions set amount = 1000 where id = c1;
  select completed_at into at_ from public.goals where id = g;
  perform pg_temp.rec('5 editing a contribution up to target sets it', 'true', (at_ is not null)::text);

  update public.goals set target_amount = 1500 where id = g;
  select completed_at into at_ from public.goals where id = g;
  perform pg_temp.rec('6a raising the target clears it', '<null>', at_::text);
  update public.goals set target_amount = 1000 where id = g;
  select completed_at into at_ from public.goals where id = g;
  perform pg_temp.rec('6b lowering it to the total sets it', 'true', (at_ is not null)::text);

  update public.goals set completed_at = null where id = g;
  select completed_at into at_ from public.goals where id = g;
  perform pg_temp.rec('7a a client can''t clear completed_at', 'true', (at_ is not null)::text);
  update public.goals set target_amount = 5000 where id = g;
  update public.goals set completed_at = now() where id = g;
  select completed_at into at_ from public.goals where id = g;
  perform pg_temp.rec('7b a client can''t set completed_at', '<null>', at_::text);
  update public.goals set target_amount = 1000 where id = g;

  select total_saved into saved from public.v_goals_summary;
  perform pg_temp.rec('8a summary counts the active goal', '1000', saved::text);
  update public.goals set is_active = false where id = g;
  select coalesce((select total_saved from public.v_goals_summary), 0) into saved;
  perform pg_temp.rec('8b archived: summary stops counting it', '0', saved::text);
  perform pg_temp.rec('8c archived: contributions kept', '1',
    (select count(*) from public.goal_contributions where goalid = g)::text);

  insert into public.goals (id, userid, goal_name, goal_type, target_amount, tracking_method)
  values (g2, u, 'Trip', 'Vacation', 100, 'Manual');
  insert into public.goal_contributions (goalid, userid, amount, date, funding_method)
  values (g2, u, 100, current_date, 'manual');
  begin
    delete from public.goals where id = g2;
    state := 'deleted';
  exception when others then
    state := sqlstate || ' ' || sqlerrm;
  end;
  perform pg_temp.rec('9 deleting a goal cascades cleanly', 'deleted', state);

  select updated_at into upd from public.goals where id = g;
  perform count(*) from public.goals;
  perform count(*) from public.v_goals_summary;
  perform pg_temp.rec('10 reads write nothing', upd::text,
    (select updated_at from public.goals where id = g)::text);

  perform pg_temp.unbecome();
end
$$;

select seq, check_, expected, actual, pass from gc_results order by seq;

rollback;
