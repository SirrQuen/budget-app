-- =====================================================================
-- Sorrel 73: function EXECUTE grants, stated explicitly
--
-- Found by docs/rls-isolation-test.sql section 2d on sorrel-dev,
-- 2026-11-18: transactions_sync_goal_completed_at() (69) was executable
-- by anon and authenticated. An audit of every function in public
-- (pg_proc on sorrel-dev, read-only, same day) found 13 such grants.
--
-- The cause is the one CLAUDE.md records for views ("Any migration that
-- creates a view uses migration 57's grant block"): `revoke all ... from
-- public` -- or no revoke at all -- leaves whatever the PROJECT's
-- default privileges hand out. sorrel-dev has the stock Supabase
-- defaults, which grant EXECUTE on every new function to anon,
-- authenticated and service_role directly, so revoking PUBLIC removes
-- nothing there. A migration can't know which project it runs on, so
-- every grant here is stated explicitly, the same on both.
--
-- The rule, from migration 36 and migration 57's block:
--
--   Trigger functions: no EXECUTE for public, anon or authenticated
--     (36). Revoking it changes nothing about the trigger: EXECUTE on a
--     trigger function is checked at CREATE TRIGGER, not when it fires.
--     Done so nobody has to re-derive that.
--
--   Callable functions: EXECUTE for exactly who calls them. These seven
--     are read by security-invoker views or by triggers that run as the
--     writing user, so authenticated keeps it; service_role keeps the
--     EXECUTE it has today. anon never reads a view (every view's grant
--     block revokes anon), so anon has no use for any of them.
--
-- Deliberately left as they are (anon keeps EXECUTE):
--   apply_user_timezone()   the pre-request hook; it runs on EVERY API
--                           request, anon's included (migration 42).
--                           Revoking it takes the API down.
--   join_waitlist(text)     the public waitlist form (migration 51).
--   username_is_available(text)
--                           granted to anon in the baseline; flagged for
--                           a ruling, not changed here (see the report).
--
-- Grants only: no table, view, row or function body changes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Trigger functions: not callable
-- ---------------------------------------------------------------------
revoke execute on function public.clear_estimate_on_amount_change()      from public, anon, authenticated;
revoke execute on function public.enforce_transfer_pair()                from public, anon, authenticated;
revoke execute on function public.goal_contributions_sync_completed_at() from public, anon, authenticated;
revoke execute on function public.goals_sync_completed_at()              from public, anon, authenticated;
revoke execute on function public.set_updated_at()                       from public, anon, authenticated;
revoke execute on function public.transactions_sync_goal_completed_at()  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Callable helpers: signed-in (and service role) only
-- ---------------------------------------------------------------------
revoke execute on function public.add_business_days(date, integer)                   from public, anon;
revoke execute on function public.estimate_expense_amount_high(uuid, numeric)        from public, anon;
revoke execute on function public.goal_completed_at(uuid, numeric, timestamptz)      from public, anon;
revoke execute on function public.has_three_supplied_amounts(uuid, text)             from public, anon;
revoke execute on function public.is_business_day(date)                              from public, anon;
revoke execute on function public.resolve_recurring_due_date(date, integer, text)    from public, anon;
revoke execute on function public.signed_amount(numeric, text)                       from public, anon;

grant execute on function public.add_business_days(date, integer)                to authenticated, service_role;
grant execute on function public.estimate_expense_amount_high(uuid, numeric)     to authenticated, service_role;
grant execute on function public.goal_completed_at(uuid, numeric, timestamptz)   to authenticated, service_role;
grant execute on function public.has_three_supplied_amounts(uuid, text)          to authenticated, service_role;
grant execute on function public.is_business_day(date)                           to authenticated, service_role;
grant execute on function public.resolve_recurring_due_date(date, integer, text) to authenticated, service_role;
grant execute on function public.signed_amount(numeric, text)                    to authenticated, service_role;
