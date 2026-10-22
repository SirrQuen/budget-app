-- =====================================================================
-- EverNest 51: the landing-page waitlist
--
-- An email address and when it arrived. Nothing else: no name, no IP, no
-- referrer. It exists to send one message when Sorrel opens.
--
-- Two properties decide whether this is safe:
--
-- 1. Nobody but the operator reads it. RLS is on with NO policies, and
--    every table privilege is revoked from anon and authenticated (Supabase's
--    default privileges grant them ALL on a new public table). The operator
--    reads it in the dashboard, as postgres.
--
-- 2. A duplicate looks exactly like a new address. join_waitlist() inserts
--    ON CONFLICT DO NOTHING and returns void either way, so no response --
--    success, error, or rate limit -- depends on whether an address is
--    already on the list. A unique-violation surfacing "you're already on
--    the list" would be an email-enumeration oracle.
--
-- anon writes only through join_waitlist(), never by INSERT on the table.
-- The publishable key is public, so anyone can call PostgREST directly and
-- skip the app; a rate limit in the server action would be skipped with it.
-- The limit therefore lives here, on the only path in: a global ceiling of
-- WAITLIST_PER_HOUR new rows in any rolling hour. It is checked before the
-- insert, so a duplicate and a new address hit it identically. Global, not
-- per-sender, because the table holds no sender: the cost is that a flood
-- can make the form answer "try again later" for the rest of the hour, and
-- the ceiling bounds the junk a flood can leave at 100 rows an hour.
--
-- The address rule matches lib/waitlistValidation.ts (the gate the server
-- action applies first, with the user-facing message). This is the backstop
-- for a caller that skipped the app: trim, lower-case, the same shape, and
-- the RFC 5321 length ceiling.
-- =====================================================================

create table public.waitlist (
  email      text primary key,
  created_at timestamptz not null default now(),
  constraint waitlist_email_normalised check (email = lower(btrim(email))),
  constraint waitlist_email_shape check (
    char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
);

comment on table public.waitlist is
  'Landing-page waitlist (migration 51). Operator-only: no RLS policy, no grant to anon/authenticated. Written only by join_waitlist().';

-- The rate limit's window scan.
create index waitlist_created_at_idx on public.waitlist (created_at);

alter table public.waitlist enable row level security;

revoke all on table public.waitlist from public, anon, authenticated;

create function public.join_waitlist(p_email text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_email text := lower(btrim(p_email));
begin
  if v_email is null
     or char_length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'not a plausible email address' using errcode = '22023';
  end if;

  -- WAITLIST_PER_HOUR. Before the insert, so it never depends on whether
  -- this address is already present.
  if (select count(*) from public.waitlist
       where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'waitlist_rate_limited' using errcode = 'P0001';
  end if;

  insert into public.waitlist (email) values (v_email)
  on conflict (email) do nothing;
end
$$;

-- Signed-out visitors only: a signed-in user never sees the landing page
-- (the proxy sends "/" to /dashboard).
revoke all on function public.join_waitlist(text) from public, authenticated;
grant execute on function public.join_waitlist(text) to anon;
