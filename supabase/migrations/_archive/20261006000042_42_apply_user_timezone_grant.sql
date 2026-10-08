-- =====================================================================
-- EverNest 42: Every API role must be able to run the pre-request hook
--
-- Migration 40 granted EXECUTE on apply_user_timezone() to anon and
-- authenticated only. PostgREST runs db_pre_request for EVERY request,
-- after switching to the request's role -- so service_role requests (the
-- billing sync, `supabase gen types`) failed with 42501 "permission
-- denied for function apply_user_timezone".
--
-- The function is safe for any caller: it reads only the caller's own
-- settings row (RLS) and sets a transaction-local GUC. Granted to PUBLIC
-- so a role added later can't break the API the same way.
-- =====================================================================

grant execute on function public.apply_user_timezone() to public;
