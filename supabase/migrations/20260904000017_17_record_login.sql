-- =====================================================================
-- 17: record_login() -- the login stamp in one round trip
--
-- lib/db/profile.ts recordLogin() read profiles.lastlogin, then wrote
-- now() back to it in a second statement: two PostgREST round trips on
-- the critical path of every authenticated route. app/(app)/layout.tsx
-- calls recordLogin() for every entry into the app (it's request-cached,
-- so the dashboard reuses the result), and at the project's DB latency
-- those two serial trips were a measurable chunk of time-to-first-byte.
--
-- The read-before-write is genuine: "is this a first-ever login" and the
-- "since you were last here" strip both need lastlogin as it stood
-- *before* this request bumps it. This function captures the old row,
-- then updates it, and returns first_name plus the prior lastlogin --
-- one function call, one round trip. The two statements inside run in a
-- single transaction against Postgres locally; the network cost is paid
-- once.
--
-- security invoker: runs as the calling user. The profiles RLS policies
-- (profiles_select_own / profiles_update_own, both id = auth.uid()) scope
-- the row, and lastlogin is already in the column-level UPDATE grant (see
-- DATABASE.md rule 4). The explicit id predicate is for intent, not
-- isolation. The trg_profiles_updated_at trigger still fires and bumps
-- updated_at, exactly as the old .update({ lastlogin }) path did.
-- =====================================================================

create or replace function public.record_login()
returns table (first_name text, previous_login_at timestamptz)
language plpgsql
volatile
security invoker
set search_path = public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_first_name text;
  v_prev timestamptz;
begin
  select p.first_name, p.lastlogin
    into v_first_name, v_prev
  from public.profiles p
  where p.id = v_uid;

  -- No profile row for this session (should not happen -- handle_new_user
  -- creates one at signup): return nothing, and the caller treats an
  -- empty result the same way the old getProfile().single() treated a
  -- missing row.
  if not found then
    return;
  end if;

  update public.profiles
     set lastlogin = now()
   where id = v_uid;

  first_name := v_first_name;
  previous_login_at := v_prev;
  return next;
end;
$fn$;

comment on function public.record_login() is
  'Stamps profiles.lastlogin = now() for the current user and returns first_name plus the PRIOR lastlogin (null on a first-ever login), in one round trip. Replaces the read-then-write in lib/db/profile.ts recordLogin().';

revoke all on function public.record_login() from public, anon;
grant execute on function public.record_login() to authenticated;


-- =====================================================================
-- Verify
-- =====================================================================

-- (a) Grants: authenticated has EXECUTE, anon/public do not.
-- select grantee, privilege_type
--   from information_schema.role_routine_grants
--  where routine_name = 'record_login';

-- (b) As an authenticated user with a known lastlogin, one call returns
-- the OLD value and leaves lastlogin advanced to ~now():
--   select * from public.record_login();
--   select lastlogin from public.profiles where id = auth.uid();

-- (c) End to end: load any authenticated route twice a few seconds apart.
-- The second load's "welcome back" copy should reflect the first load's
-- timestamp, and updated_at should track lastlogin.


-- =====================================================================
-- Rollback
-- =====================================================================
-- drop function if exists public.record_login();
-- (restore the read-then-write in lib/db/profile.ts recordLogin())
