-- =====================================================================
-- month_story() for the dev test user's October 2026 (migration 71)
--
-- sorrel-dev (tztbebdzlezlhvsbylsf) ONLY: it reads the seeded test user
-- 7e9a84e3-90b3-4cca-b6d1-d640128a77d8, who exists nowhere else.
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/month-story-test.sql
--
-- Writes nothing: one transaction, ending in ROLLBACK, and the only
-- statements in it set the session's role and claims (transaction-local)
-- and read. It becomes the user exactly as PostgREST does -- and as
-- docs/rls-isolation-test.sql does -- so RLS, auth.uid() and the user's
-- zone (America/New_York, read by user_time_zone()) apply as in a request.
-- It switches role, so it can't run --read-only; the CLI asks you to
-- confirm.
--
-- Expected figures are the Phase 1 report's (2026-11-16): 18 logs,
-- $950 set aside (Japan trip $650, Bike fund $300), the archived
-- Emergency fund's $500 left out, Japan trip at $1,050 of $3,000 by
-- 31 October = 35%, no goal following a card. Clean only when every
-- `pass` is true. A change to that user's data changes these.
-- =====================================================================

begin;

select set_config('request.jwt.claims',
  json_build_object('sub', '7e9a84e3-90b3-4cca-b6d1-d640128a77d8', 'role', 'authenticated')::text, true);
set local role authenticated;

with s as (
  select * from public.month_story('2026-10-01')
),
top as (
  select s.goals -> 0 as g from s
),
japan as (
  select e as g
    from s, jsonb_array_elements(s.goals) e
   where e ->> 'name' = 'Japan trip'
),
checks(seq, check_, expected, actual) as (
  select 1, 'acting as the test user', '7e9a84e3-90b3-4cca-b6d1-d640128a77d8', coalesce(auth.uid()::text, '<null>')
  union all
  select 2, 'month', '2026-10-01', (select month_start::text from s)
  union all
  select 3, 'logs (created in October, not imported, one per transfer)', '18', (select logs::text from s)
  union all
  select 4, 'goal total', '950', (select goal_total::numeric::text from s)
  union all
  select 5, 'top goal', 'Japan trip', (select g ->> 'name' from top)
  union all
  select 6, 'top goal amount', '650', (select ((g ->> 'amount')::numeric)::text from top)
  union all
  select 7, 'goals listed (Japan trip, Bike fund)', '2', (select jsonb_array_length(goals)::text from s)
  union all
  select 8, 'archived goals excluded (none listed, Emergency fund among them)', '0',
    (select count(*)::text
       from s, jsonb_array_elements(s.goals) e
       join public.goals g on g.id = (e ->> 'goal_id')::uuid
      where not g.is_active or g.goal_name = 'Emergency fund')
  union all
  select 9, 'Japan trip at month end: % of target', '35.0', (select (g ->> 'pct_by_month_end') from japan)
  union all
  select 10, 'no card-paydown rows (no goal follows a card)', '0', (select jsonb_array_length(cards)::text from s)
)
select seq, check_ as check, expected, actual,
       coalesce(
         case when seq in (4, 6, 9) then actual::numeric = expected::numeric
              else actual = expected end,
         false) as pass
  from checks
 order by seq;

rollback;
