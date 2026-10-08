-- =====================================================================
-- EverNest 36: Internal SECURITY DEFINER functions are not callable
--
-- Postgres grants EXECUTE to PUBLIC on every new function. Four
-- SECURITY DEFINER functions never had that default revoked, so anon and
-- authenticated could reach them through /rest/v1/rpc/*:
--
--   seed_default_categories(p_userid)  THE HOLE. Runs as owner, bypasses
--     RLS, and trusts p_userid -- anyone holding the public anon key could
--     insert default category_groups/categories into ANY user's account
--     (re-adding defaults they had deleted or renamed). Its only legitimate
--     caller is handle_new_user(), which already runs as the owner.
--
--   handle_new_user(), enforce_category_type(),
--   enforce_recurring_variability_scope()
--     Trigger functions. Postgres refuses to call these outside a trigger
--     and PostgREST does not expose functions returning `trigger`, so this
--     closes nothing today. Revoked so no future reader has to re-derive
--     that.
--
-- Triggers are unaffected: EXECUTE on a trigger function is checked at
-- CREATE TRIGGER time, not when the trigger fires.
--
-- docs/rls-isolation-test.sql asserts these grants so a later migration
-- cannot silently re-open them.
-- =====================================================================

revoke all on function public.seed_default_categories(uuid)
  from public, anon, authenticated;

revoke all on function public.handle_new_user()
  from public, anon, authenticated;
revoke all on function public.enforce_category_type()
  from public, anon, authenticated;
revoke all on function public.enforce_recurring_variability_scope()
  from public, anon, authenticated;
