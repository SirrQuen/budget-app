-- =====================================================================
-- 34: profiles.preferred_name -- what the user wants to be called
--
-- Optional at signup ("Preferred name", max 30) and editable in Settings.
-- The greeting prefers it over first_name; the sidebar prefers the full
-- name. Resolution lives in lib/displayName.ts, not here.
--
-- NULLABLE, no default. The signup-breaking bug in migration 15 was a
-- NOT NULL column handle_new_user() wrote null into; this column is null
-- for everyone who skips the field, which is most people.
--
-- The check trims before measuring, so whitespace-only can't pose as a
-- name -- the app stores null for blank rather than ''.
-- =====================================================================

alter table public.profiles
  add column if not exists preferred_name text;

alter table public.profiles
  drop constraint if exists profiles_preferred_name_length;
alter table public.profiles
  add constraint profiles_preferred_name_length
  check (preferred_name is null or char_length(btrim(preferred_name)) between 1 and 30);


-- =====================================================================
-- Column-level UPDATE grant
--
-- REQUIRED. profiles UPDATE is granted per column (migrations 02/03/05),
-- and a new column is not covered -- without this, saving the name from
-- Settings fails with a bare permission error. Additive: the existing
-- column grants stand. subscription_* stay excluded.
-- =====================================================================

grant update (preferred_name) on public.profiles to authenticated;


-- =====================================================================
-- handle_new_user() -- read preferred_name from signup metadata
--
-- Otherwise identical to migration 09. Blank or whitespace-only becomes
-- null (the check above would reject it and abort signup). Over-length is
-- validated by the signup action before signUp() is called; if a client
-- bypassed that, the check fails the insert rather than truncating
-- silently.
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.profiles (id, first_name, last_name, username, phone, preferred_name, lastlogin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name',  ''),
    nullif(new.raw_user_meta_data ->> 'username', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'phone', ''), new.phone),
    nullif(btrim(new.raw_user_meta_data ->> 'preferred_name'), ''),
    null
  );

  insert into public.settings (userid) values (new.id);

  begin
    perform public.seed_default_categories(new.id);
  exception when others then
    raise warning 'seed_default_categories failed for user %: %', new.id, sqlerrm;
  end;

  return new;
end;
$fn$;


-- =====================================================================
-- record_login() -- also return the name fields
--
-- The app layout calls this on every authenticated request already; the
-- sidebar identity and the dashboard greeting both need the names, so
-- they ride along in the same round trip rather than costing a second
-- profiles read. The return type changes, which CREATE OR REPLACE can't
-- do -- drop and recreate, then restore the grants from migration 17.
-- =====================================================================

drop function if exists public.record_login();

create function public.record_login()
returns table (
  first_name text,
  last_name text,
  preferred_name text,
  previous_login_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_first_name text;
  v_last_name text;
  v_preferred_name text;
  v_prev timestamptz;
begin
  select p.first_name, p.last_name, p.preferred_name, p.lastlogin
    into v_first_name, v_last_name, v_preferred_name, v_prev
  from public.profiles p
  where p.id = v_uid;

  if not found then
    return;
  end if;

  update public.profiles
     set lastlogin = now()
   where id = v_uid;

  first_name := v_first_name;
  last_name := v_last_name;
  preferred_name := v_preferred_name;
  previous_login_at := v_prev;
  return next;
end;
$fn$;

comment on function public.record_login() is
  'Stamps profiles.lastlogin = now() for the current user and returns the name fields plus the PRIOR lastlogin (null before any authenticated request), in one round trip.';

revoke all on function public.record_login() from public, anon;
grant execute on function public.record_login() to authenticated;


-- =====================================================================
-- Verify
-- =====================================================================

-- (a) Grant includes preferred_name, still excludes subscription_*:
-- select column_name from information_schema.column_privileges
--  where table_schema = 'public' and table_name = 'profiles'
--    and grantee = 'authenticated' and privilege_type = 'UPDATE' order by 1;

-- (b) End to end: sign up through the app with and without a preferred
-- name. Both must succeed; the profile row carries the name or null.


-- =====================================================================
-- Rollback
-- =====================================================================
-- Restore handle_new_user() from migration 09 and record_login() from
-- migration 17 (drop first -- the return type differs), then:
-- revoke update (preferred_name) on public.profiles from authenticated;
-- alter table public.profiles drop constraint if exists profiles_preferred_name_length;
-- alter table public.profiles drop column if exists preferred_name;
