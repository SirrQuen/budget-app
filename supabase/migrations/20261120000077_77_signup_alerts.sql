-- =====================================================================
-- Sorrel 77: an email to the operator when someone joins the waitlist or
-- applies to be a beta tester
--
-- Ruled 2026-11-20: a pg_cron job every 5 minutes, NO trigger; Postgres
-- calls Resend's HTTP API directly through pg_net, the key in Vault.
--
-- Nothing is added to the submission path. join_waitlist() and
-- submit_beta_application() are untouched: a failed or slow email can't
-- fail or slow a signup, because no signup waits on one. The job counts
-- rows whose created_at is after the last count -- a repeat waitlist
-- address writes no row (ON CONFLICT DO NOTHING, migration 51) and a
-- repeat beta application sets only updated_at (migration 75), so a
-- repeat sends nothing.
--
-- The email holds the type, the counts and a Supabase link. NEVER a name,
-- an address or an answer: Resend is listed in the privacy policy only for
-- confirmations and password resets, and the policy says waitlist and
-- application data is held in Supabase where "only we can see it". An
-- email carrying applicant data would make both untrue.
-- docs/signup-alerts-test.sql pins the text (the privacy pin).
--
--   signup_alerts      one row per type: how far it has counted, when it
--                      last sent, the pg_net request in flight, and why it
--                      last did or didn't send. Counts and times only.
--   signup_alert_log   'log' mode's output: the email it WOULD have sent.
--   signup_alert_text()   the email's subject and body, from counts.
--   signup_alerts_run()   the work, given the mode, key and recipient.
--   send_signup_alerts()  the cron entry point: reads the three Vault
--                         secrets and calls signup_alerts_run().
--
-- Vault secrets (set by Matt in the dashboard, never in the repo):
--   signup_alerts_resend_key   a Resend API key, sending access only
--   signup_alerts_to           the operator's address
--   signup_alerts_mode         'log' writes signup_alert_log instead of
--                              sending; anything else, or unset, sends
--
-- Flood protection: at most one email per type per 15 minutes. Rows that
-- arrive inside the window stay uncounted and go out together in the next
-- one ("23 new waitlist signups in the last 40 minutes"). A send that
-- doesn't come back 2xx doesn't advance last_checked_at, so the next
-- allowed run counts those rows again.
--
-- Supabase enables the extensions this way (docs, read 2026-11-20):
-- pg_cron in pg_catalog, with cron's usage granted to postgres; pg_net in
-- "extensions", its functions in the net schema. pg_net starts a request
-- only when the calling transaction commits.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Extensions
-- ---------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create extension if not exists pg_net with schema extensions;


-- ---------------------------------------------------------------------
-- 2. signup_alerts: counts and times, nothing personal
-- ---------------------------------------------------------------------
create table public.signup_alerts (
  kind               text primary key,
  -- The created_at high-water mark already counted (and sent, or logged).
  last_checked_at    timestamptz not null,
  -- When an email last went out (or was attempted, or logged).
  last_sent_at       timestamptz,
  -- A pg_net request in flight, the high-water mark it covers, and when.
  pending_request_id bigint,
  pending_through    timestamptz,
  pending_sent_at    timestamptz,
  -- Why the last run did what it did: 'sent (HTTP 200)', 'logged',
  -- 'skipped: no signup_alerts_resend_key', 'failed: HTTP 422', ...
  last_status        text not null default 'seeded',
  updated_at         timestamptz not null default now(),
  constraint signup_alerts_kind_check check (kind in ('waitlist', 'beta')),
  constraint signup_alerts_pending_together check (
    (pending_request_id is null) = (pending_through is null)
    and (pending_request_id is null) = (pending_sent_at is null))
);

comment on table public.signup_alerts is
  'One row per alert type (waitlist, beta): how far the signup-alert job has counted, when it last emailed, the pg_net request in flight and why it last did or did not send. Counts and timestamps only -- no address, name or row id. Written only by signup_alerts_run(); no API role can read it (migration 77).';

-- Seeded at the migration's own time: signups that already exist are
-- not announced. The first email is for the first row after this.
insert into public.signup_alerts (kind, last_checked_at) values
  ('waitlist', now()),
  ('beta', now());

create table public.signup_alert_log (
  id         bigint generated always as identity primary key,
  kind       text not null,
  subject    text not null,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint signup_alert_log_kind_check check (kind in ('waitlist', 'beta'))
);

comment on table public.signup_alert_log is
  'In signup_alerts_mode = ''log'': the email the job would have sent, instead of sending it. The same text as a real email -- counts and a link only. For testing on dev (migration 77).';

-- RLS on, no policy, and no privilege for any API role: the operator
-- reads these in the dashboard; the functions below write them.
alter table public.signup_alerts enable row level security;
alter table public.signup_alert_log enable row level security;
revoke all on table public.signup_alerts from public, anon, authenticated, service_role;
revoke all on table public.signup_alert_log from public, anon, authenticated, service_role;
revoke all on sequence public.signup_alert_log_id_seq from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------
-- 3. signup_alert_text(): the email, from counts
--
-- Immutable and given only numbers: it CAN'T include anything from a row.
-- ---------------------------------------------------------------------
create function public.signup_alert_text(
  p_kind    text,
  p_new     integer,
  p_total   bigint,
  p_minutes integer,
  out subject text,
  out body    text
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_one  text := case p_kind when 'waitlist' then 'waitlist signup' else 'beta application' end;
  v_many text := case p_kind when 'waitlist' then 'waitlist signups' else 'beta applications' end;
  v_link text := 'Open Supabase to view: https://supabase.com/dashboard/projects';
begin
  if p_kind not in ('waitlist', 'beta') or p_new < 1 then
    raise exception 'signup_alert_text: nothing to say' using errcode = '22023';
  end if;
  if p_new = 1 then
    subject := 'New ' || v_one;
    body := 'New ' || v_one || ' — ' || p_total || ' so far.' || E'\n\n' || v_link;
  else
    subject := p_new || ' new ' || v_many;
    body := p_new || ' new ' || v_many || ' in the last ' || greatest(p_minutes, 1)
            || case when greatest(p_minutes, 1) = 1 then ' minute' else ' minutes' end
            || ' — ' || p_total || ' so far.' || E'\n\n' || v_link;
  end if;
end;
$$;

comment on function public.signup_alert_text(text, integer, bigint, integer) is
  'The signup alert''s subject and body from numbers only -- type, how many are new, the running total, minutes covered -- and a Supabase link. Takes no row, so it can''t include an address, name or answer (migration 77).';


-- ---------------------------------------------------------------------
-- 4a. signup_alerts_settle(): what a finished send means
--
-- 2xx: the rows it covered are done -- last_checked_at moves to the
-- request's high-water mark. Anything else (another status, a timeout, an
-- error, no response): last_checked_at stays, so the next allowed run
-- counts those rows again; last_sent_at was set when the attempt went out,
-- so the retry still waits out the 15 minutes. Its own function so the
-- test script can settle a made-up response without writing into pg_net's
-- tables.
-- ---------------------------------------------------------------------
create function public.signup_alerts_settle(
  p_kind        text,
  p_status_code integer,
  p_timed_out   boolean,
  p_error       text,
  p_now         timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status_code between 200 and 299 then
    update public.signup_alerts
       set last_checked_at = pending_through,
           last_status = 'sent (HTTP ' || p_status_code || ')'
     where kind = p_kind and pending_request_id is not null;
  else
    update public.signup_alerts
       set last_status = 'failed: ' || case
             when p_timed_out then 'timed out'
             when p_status_code is not null then 'HTTP ' || p_status_code
             else coalesce(left(p_error, 80), 'no status') end
     where kind = p_kind and pending_request_id is not null;
  end if;
  update public.signup_alerts
     set pending_request_id = null, pending_through = null, pending_sent_at = null, updated_at = p_now
   where kind = p_kind;
end;
$$;

comment on function public.signup_alerts_settle(text, integer, boolean, text, timestamptz) is
  'Settles a signup-alert send: 2xx advances last_checked_at to what the request covered; anything else leaves it, so the rows are counted again after the 15-minute wait. Clears the pending request. Called by signup_alerts_run() and the test script; no API role may run it (migration 77).';


-- ---------------------------------------------------------------------
-- 4. signup_alerts_run(): the work
--
-- Per type: settle a send in flight; count new rows; respect the
-- 15-minute cap; then log, skip (and say why), or send. p_now is the
-- clock, so the test script can move it.
-- ---------------------------------------------------------------------
create function public.signup_alerts_run(
  p_now  timestamptz,
  p_mode text,
  p_key  text,
  p_to   text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind  text;
  v_s     public.signup_alerts%rowtype;
  v_resp  record;
  v_new   integer;
  v_first timestamptz;
  v_last  timestamptz;
  v_total bigint;
  v_text  record;
  v_req   bigint;
begin
  foreach v_kind in array array['waitlist', 'beta'] loop
    select * into v_s from public.signup_alerts where kind = v_kind for update;
    if not found then
      continue;
    end if;

    -- A send in flight: settle it first, from pg_net's response.
    if v_s.pending_request_id is not null then
      select r.status_code, r.timed_out, r.error_msg into v_resp
        from net._http_response r where r.id = v_s.pending_request_id;
      if found then
        perform public.signup_alerts_settle(v_kind, v_resp.status_code, coalesce(v_resp.timed_out, false),
                                            v_resp.error_msg, p_now);
      elsif v_s.pending_sent_at < p_now - interval '1 hour' then
        -- No response an hour on: treat it as failed, count again later.
        perform public.signup_alerts_settle(v_kind, null, false, 'no response', p_now);
      else
        continue;  -- still in flight
      end if;
      select * into v_s from public.signup_alerts where kind = v_kind;
    end if;

    -- New rows since the last count.
    if v_kind = 'waitlist' then
      select count(*)::integer, min(created_at), max(created_at) into v_new, v_first, v_last
        from public.waitlist where created_at > v_s.last_checked_at and created_at <= p_now;
    else
      select count(*)::integer, min(created_at), max(created_at) into v_new, v_first, v_last
        from public.beta_applications where created_at > v_s.last_checked_at and created_at <= p_now;
    end if;
    if v_new = 0 then
      continue;
    end if;

    -- At most one email per type per 15 minutes; the rest wait for the next.
    if v_s.last_sent_at is not null and v_s.last_sent_at > p_now - interval '15 minutes' then
      update public.signup_alerts set last_status = 'waiting: sent in the last 15 minutes', updated_at = p_now
       where kind = v_kind;
      continue;
    end if;

    if v_kind = 'waitlist' then
      select count(*) into v_total from public.waitlist where created_at <= p_now;
    else
      select count(*) into v_total from public.beta_applications where created_at <= p_now;
    end if;
    select * into v_text from public.signup_alert_text(
      v_kind, v_new, v_total, ceil(extract(epoch from (p_now - v_first)) / 60)::integer);

    if p_mode = 'log' then
      insert into public.signup_alert_log (kind, subject, body, created_at)
      values (v_kind, v_text.subject, v_text.body, p_now);
      update public.signup_alerts
         set last_checked_at = v_last, last_sent_at = p_now, last_status = 'logged', updated_at = p_now
       where kind = v_kind;
      continue;
    end if;

    -- Missing configuration: send nothing, say why, count nothing -- the
    -- rows are announced once it's set.
    if coalesce(btrim(p_key), '') = '' then
      update public.signup_alerts set last_status = 'skipped: no signup_alerts_resend_key', updated_at = p_now
       where kind = v_kind;
      continue;
    end if;
    if coalesce(btrim(p_to), '') = '' then
      update public.signup_alerts set last_status = 'skipped: no signup_alerts_to', updated_at = p_now
       where kind = v_kind;
      continue;
    end if;

    v_req := net.http_post(
      url := 'https://api.resend.com/emails',
      body := jsonb_build_object(
        'from', 'Sorrel <hello@mysorrel.com>',
        'to', jsonb_build_array(btrim(p_to)),
        'subject', v_text.subject,
        'text', v_text.body),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || btrim(p_key)),
      timeout_milliseconds := 5000);

    update public.signup_alerts
       set pending_request_id = v_req, pending_through = v_last, pending_sent_at = p_now,
           last_sent_at = p_now, last_status = 'sending', updated_at = p_now
     where kind = v_kind;
  end loop;
end;
$$;

comment on function public.signup_alerts_run(timestamptz, text, text, text) is
  'The signup-alert job''s work, given the clock, mode, key and recipient: per type, settles a pg_net send in flight (2xx advances last_checked_at; anything else leaves it, so the rows are counted again), counts rows created since, holds to one email per 15 minutes, then logs (mode ''log''), skips with a reason (no key / no recipient), or POSTs to Resend. Counts and times only. Called by send_signup_alerts() and the test script; no API role may run it (migration 77).';


-- ---------------------------------------------------------------------
-- 5. send_signup_alerts(): the cron entry point
-- ---------------------------------------------------------------------
create function public.send_signup_alerts(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_key  text;
  v_to   text;
begin
  select decrypted_secret into v_mode from vault.decrypted_secrets where name = 'signup_alerts_mode';
  select decrypted_secret into v_key  from vault.decrypted_secrets where name = 'signup_alerts_resend_key';
  select decrypted_secret into v_to   from vault.decrypted_secrets where name = 'signup_alerts_to';
  perform public.signup_alerts_run(p_now, btrim(coalesce(v_mode, '')), v_key, v_to);
end;
$$;

comment on function public.send_signup_alerts(timestamptz) is
  'Run every 5 minutes by pg_cron (job signup-alerts). Reads the Vault secrets signup_alerts_mode, signup_alerts_resend_key and signup_alerts_to and calls signup_alerts_run(). No API role may run it (migration 77).';

-- No API role runs any of these: cron runs as postgres.
revoke all on function public.signup_alert_text(text, integer, bigint, integer) from public, anon, authenticated, service_role;
revoke all on function public.signup_alerts_settle(text, integer, boolean, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.signup_alerts_run(timestamptz, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.send_signup_alerts(timestamptz) from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------
-- 6. The schedule: every 5 minutes
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'signup-alerts') then
    perform cron.unschedule('signup-alerts');
  end if;
end
$$;

select cron.schedule('signup-alerts', '*/5 * * * *', $job$select public.send_signup_alerts()$job$);
