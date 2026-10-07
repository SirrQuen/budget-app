-- =====================================================================
-- EverNest 40: "Today" is the user's calendar day, not the server's
--
-- Every `current_date` in this schema (v_upcoming_recurring's
-- days_until / is_overdue / end_date filter, the current-month window in
-- v_dashboard_kpis and v_category_activity, v_goal_progress,
-- suggested_safe_to_spend_cushion(), accounts.opening_date's default)
-- resolved in the database's zone, UTC. For a user in New York that
-- moved "today" forward at 8pm EDT.
--
-- current_date is the date of now() in the session's TimeZone, so
-- rather than rewrite each of those objects, PostgREST's pre-request hook
-- sets TimeZone to the user's zone at the start of every request. Every
-- existing and future current_date then means the user's day with no
-- per-object change.
--
--   settings.timezone   IANA name ("America/New_York"), written by the
--                       app from the browser (components/TimezoneSync).
--                       Null until the first authenticated page load
--                       after this migration; null means UTC everywhere,
--                       in SQL and in lib/date.ts's todayInZone.
--
--   apply_user_timezone()  db_pre_request. SET LOCAL semantics
--                       (set_config(..., true)) -- scoped to the request's
--                       transaction, never leaks to the next request on
--                       the pooled connection. Never raises: an anonymous
--                       request, a missing row, or a zone name Postgres
--                       doesn't know all leave the session on UTC rather
--                       than failing every API call.
--
-- Side effect: timestamptz values in API responses now carry the user's
-- offset ("...-04:00") instead of "+00:00". Same instants; nothing in the
-- app parses the offset textually (checked 2026-10-06).
--
-- The service role (billing sync) is unaffected and stays on UTC -- it
-- has no auth.uid().
-- =====================================================================

alter table public.settings
  add column if not exists timezone text;

alter table public.settings drop constraint if exists settings_timezone_length;
alter table public.settings add constraint settings_timezone_length
  check (timezone is null or char_length(timezone) between 1 and 64);

comment on column public.settings.timezone is
  'IANA zone for the user''s calendar day. Applied per request by apply_user_timezone(); null = UTC.';

create or replace function public.apply_user_timezone()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  tz text;
begin
  if auth.uid() is null then
    return;
  end if;

  -- RLS scopes settings to the caller's one row.
  select s.timezone into tz from public.settings s;

  if tz is not null then
    perform set_config('timezone', tz, true);
  end if;
exception when others then
  -- Unknown zone name, or settings unreadable: stay on UTC.
  return;
end;
$$;

comment on function public.apply_user_timezone() is
  'PostgREST db_pre_request: sets TimeZone for the request transaction to settings.timezone, so current_date is the user''s day.';

revoke all on function public.apply_user_timezone() from public;
grant execute on function public.apply_user_timezone() to anon, authenticated;

alter role authenticator set pgrst.db_pre_request = 'public.apply_user_timezone';
notify pgrst, 'reload config';


-- =====================================================================
-- Verify
-- =====================================================================
-- The hook is registered:
-- select rolconfig from pg_roles where rolname = 'authenticator';
--
-- End to end: set your settings.timezone to 'Pacific/Kiritimati' (UTC+14)
-- and v_upcoming_recurring.days_until drops by one for most of the day
-- compared with 'Etc/GMT+12'.
