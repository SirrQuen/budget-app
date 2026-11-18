-- =====================================================================
-- Sorrel 74: username_is_available() is not callable by the API
--
-- Ruled 2026-11-18 (batch H, after migration 73's grant audit).
--
-- username_is_available(text) is SECURITY DEFINER and was granted to
-- anon and authenticated in the baseline. The app has no username login
-- and signup collects no username (CLAUDE.md, "Backend contract"), so
-- nothing needs it: its only wrapper, checkUsernameAvailable()
-- (lib/db/profile.ts), is imported nowhere. As granted it answered "is
-- this username taken?" for anyone holding the public anon key.
--
-- The function is kept; EXECUTE is revoked from public, anon and
-- authenticated. service_role's grant is left as it is. When username
-- login is built, the rule is already written: usernames resolve
-- server-side only (email_for_username() is service_role-only).
-- =====================================================================

revoke execute on function public.username_is_available(text) from public, anon, authenticated;
