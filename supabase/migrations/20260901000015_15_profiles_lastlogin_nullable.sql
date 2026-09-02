-- =====================================================================
-- 15 -- profiles.lastlogin is nullable (fixes broken signup)
--
-- Migration 09 rewrote handle_new_user() to insert `lastlogin = null` --
-- "lastlogin should mean last login, not signup time" -- but never
-- changed the column, which is still NOT NULL with a `now()` default.
-- An explicit null in the INSERT overrides the default and trips the
-- NOT NULL constraint, so EVERY signup has been failing since 09 with
-- "Database error saving new user".
--
-- lastlogin genuinely has no value before a user's first login, so
-- nullable is the correct shape (lib/db/profile.ts recordLogin() already
-- reads `lastlogin === null` as "first login"). Drop the default too: the
-- only INSERT into profiles is handle_new_user(), which sets the column
-- explicitly, so a now()-at-signup default is both unused and exactly the
-- value 09 set out to stop writing.
--
-- No backfill: rows created before 09 have a real prior-login timestamp
-- (or the now()-at-signup value from the old bug); either way they have
-- been through a login and are left as-is.
-- =====================================================================

alter table public.profiles alter column lastlogin drop not null;
alter table public.profiles alter column lastlogin drop default;


-- =====================================================================
-- Verify
-- =====================================================================

-- (a) lastlogin: is_nullable = YES, column_default = null.
-- select column_name, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'profiles'
--    and column_name = 'lastlogin';

-- (b) Every other NOT NULL column on profiles either has a default or is
-- set by handle_new_user(). Expect only id / first_name / last_name
-- (all three supplied by the trigger) with no default:
-- select column_name, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'profiles'
--    and is_nullable = 'NO' and column_default is null;

-- (c) End to end: sign up a fresh user through the app. It should succeed,
-- and select lastlogin from public.profiles where id = '<new uid>'
-- should be non-null (recordLogin() stamps it on first authenticated load).


-- =====================================================================
-- Rollback
-- =====================================================================
-- alter table public.profiles alter column lastlogin set default now();
-- update public.profiles set lastlogin = now() where lastlogin is null;
-- alter table public.profiles alter column lastlogin set not null;
