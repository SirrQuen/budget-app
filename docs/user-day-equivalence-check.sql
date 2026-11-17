-- user_day() after migration 71 against the expression it carried before
-- (migration 70). Writes nothing. The read-only CLI role can't execute
-- user_day(), so this runs as a plain query (it asks you to confirm):
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/user-day-equivalence-check.sql
--
-- One row. Clean only when differ is 0. Covers every real user, a null
-- user id and a user with no settings row (a random uuid), at now, both
-- 2026 US DST changes and a null instant. The null-timezone and
-- unknown-zone cases need written rows, so they live in
-- docs/debt-goal-test.sql (rolled back).

with u(uid) as (
  select id from auth.users
  union all select null::uuid
  union all select gen_random_uuid()
),
t(at) as (
  values (now()),
         ('2026-03-08 06:59:59+00'::timestamptz),
         ('2026-03-08 07:00:00+00'::timestamptz),
         ('2026-11-01 05:30:00+00'::timestamptz),
         ('2026-11-01 06:30:00+00'::timestamptz),
         (null::timestamptz)
)
select count(*) as checked,
       count(*) filter (where public.user_day(uid, at) is distinct from
         (at at time zone coalesce(
            (select s.timezone
               from public.settings s
              where s.userid = uid
                and s.timezone in (select name from pg_catalog.pg_timezone_names)),
            'UTC'))::date) as differ
  from u, t;
