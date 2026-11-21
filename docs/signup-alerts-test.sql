-- =====================================================================
-- Signup alerts test (migration 77)
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/signup-alerts-test.sql
--
-- It writes, then rolls back, so it isn't --read-only and the CLI asks
-- for confirmation: Matt runs it. Read the Target line first.
--
-- A run counts as passed only when its LAST row, SUMMARY, says ALL PASS
-- (CLAUDE.md). One transaction, rolled back: the throwaway waitlist
-- addresses and beta application (@example.invalid) and every change to
-- signup_alerts go with it. pg_net starts a request only when its
-- transaction commits, so the one queued here (section 8) is never sent.
-- Cleanup check (must be 0):
--   select count(*) from public.waitlist where email like 'sa-test-%';
--
-- The clock is p_now, passed to signup_alerts_run(); t0 is this
-- transaction's now(), which is also the created_at of every row the
-- real functions write here.
--
--   1  The migration's state: both types seeded, the job scheduled every
--      5 minutes, no API role can read the tables or run the functions.
--   2  Nothing new: nothing logged, nothing changed.
--   3  One new waitlist signup (through join_waitlist(), as anon): one
--      email, "New waitlist signup -- N so far.", N the real total.
--   4  The same address again (other case, spaces): no row, no email.
--   5  The 15-minute cap: three more inside the window wait; the first
--      run after it sends ONE email for all three, "3 new ... in the last
--      15 minutes".
--   6  One new beta application (as anon): its own email; the same email
--      applying again (new answers) sends nothing.
--   7  Missing key / missing recipient (send mode): nothing sent, the
--      reason recorded, the rows still uncounted for when it's set.
--   8  Send mode: one pg_net request to Resend, the rows held as pending
--      (not yet counted); while in flight, a run does nothing.
--   9  A 2xx settles: the rows are counted. A non-2xx (or timeout, or no
--      response after an hour): not counted, so the next allowed run
--      sends them again.
--  10  The privacy pin: no subject, body or queued request contains an
--      address or name from the rows, and every email matches the fixed
--      shape: counts, type and the Supabase link only.
-- =====================================================================

begin;

create temp table sa_results (
  seq      serial primary key,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);

create function pg_temp.rec(p_check text, p_expected text, p_actual text) returns void
language sql as $$
  insert into sa_results (check_, expected, actual, pass)
  values (p_check, p_expected, coalesce(p_actual, '<null>'), coalesce(p_expected = p_actual, false))
$$;

create function pg_temp.become_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end
$$;

create function pg_temp.unbecome() returns void language plpgsql as $$
begin
  execute 'set local role none';
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- join_waitlist() as anon, the way the landing page calls it.
create function pg_temp.join_list(p_email text) returns void language plpgsql as $$
begin
  perform pg_temp.become_anon();
  perform public.join_waitlist(p_email);
  perform pg_temp.unbecome();
end
$$;

-- submit_beta_application() as anon: a complete, valid application.
create function pg_temp.apply(p_email text, p_name text, p_age text) returns void language plpgsql as $$
begin
  perform pg_temp.become_anon();
  perform public.submit_beta_application(
    p_email, p_name, p_age, 'describes_other', 'experience_some',
    array['method_paper', 'method_other'], 'challenge_bills', 'want_safe_to_spend',
    'available_yes', 'comfortable_yes', 'frequency_daily', 'reason_other', true, '');
  perform pg_temp.unbecome();
end
$$;

create function pg_temp.state(p_kind text) returns text language sql as $$
  select last_status from public.signup_alerts where kind = p_kind
$$;

create function pg_temp.logged(p_kind text) returns bigint language sql as $$
  select count(*) from public.signup_alert_log where kind = p_kind
$$;

create function pg_temp.last_body(p_kind text) returns text language sql as $$
  select body from public.signup_alert_log where kind = p_kind order by id desc limit 1
$$;

create function pg_temp.total(p_table text, p_now timestamptz) returns bigint language plpgsql as $$
declare v bigint;
begin
  execute format('select count(*) from public.%I where created_at <= $1', p_table) into v using p_now;
  return v;
end
$$;

do $$
declare
  t0      constant timestamptz := now();
  c_link  constant text := E'\n\nOpen Supabase to view: https://supabase.com/dashboard/projects';
  v_n     bigint;
  v_txt   text;
  v_chk   timestamptz;
  v_req   bigint;
  v_role  text;
  v_priv  text;
  v_fn    text;
begin
  -- 1 -----------------------------------------------------------------
  perform pg_temp.rec('1 both types are seeded', 'beta,waitlist',
    (select string_agg(kind, ',' order by kind) from public.signup_alerts));
  perform pg_temp.rec('1 the job runs every 5 minutes', '*/5 * * * * select public.send_signup_alerts()',
    (select schedule || ' ' || command from cron.job where jobname = 'signup-alerts'));
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      perform pg_temp.rec('1 ' || v_role || ' has no ' || v_priv || ' on signup_alerts or signup_alert_log', 'false false',
        has_table_privilege(v_role, 'public.signup_alerts', v_priv)::text || ' '
          || has_table_privilege(v_role, 'public.signup_alert_log', v_priv)::text);
    end loop;
    foreach v_fn in array array[
      'public.send_signup_alerts(timestamptz)',
      'public.signup_alerts_run(timestamptz,text,text,text)',
      'public.signup_alerts_settle(text,integer,boolean,text,timestamptz)',
      'public.signup_alert_text(text,integer,bigint,integer)'] loop
      perform pg_temp.rec('1 ' || v_role || ' cannot run ' || v_fn, 'false',
        has_function_privilege(v_role, v_fn, 'EXECUTE')::text);
    end loop;
  end loop;

  -- A known starting point inside this transaction: counted up to just
  -- before t0, never sent. Rows already on dev stay counted.
  update public.signup_alerts
     set last_checked_at = t0 - interval '1 second', last_sent_at = null, pending_request_id = null,
         pending_through = null, pending_sent_at = null, last_status = 'test start';

  -- 2 -----------------------------------------------------------------
  perform public.signup_alerts_run(t0 + interval '1 minute', 'log', null, null);
  perform pg_temp.rec('2 nothing new: nothing logged, nothing changed', '0 0 test start test start',
    pg_temp.logged('waitlist') || ' ' || pg_temp.logged('beta') || ' '
      || pg_temp.state('waitlist') || ' ' || pg_temp.state('beta'));

  -- 3 -----------------------------------------------------------------
  perform pg_temp.join_list('sa-test-one@example.invalid');
  perform public.signup_alerts_run(t0 + interval '1 minute', 'log', null, null);
  perform pg_temp.rec('3 one new signup: one email', '1', pg_temp.logged('waitlist')::text);
  perform pg_temp.rec('3 ... saying so, with the real total',
    'New waitlist signup — ' || pg_temp.total('waitlist', t0 + interval '1 minute') || ' so far.' || c_link,
    pg_temp.last_body('waitlist'));
  perform pg_temp.rec('3 ... subject', 'New waitlist signup',
    (select subject from public.signup_alert_log where kind = 'waitlist' order by id desc limit 1));
  perform pg_temp.rec('3 ... and the row counted', 'logged ' || t0,
    (select last_status || ' ' || last_checked_at from public.signup_alerts where kind = 'waitlist'));

  -- 4 -----------------------------------------------------------------
  perform pg_temp.join_list('  SA-TEST-ONE@Example.INVALID ');
  perform pg_temp.rec('4 the same address again writes no row', '1',
    (select count(*)::text from public.waitlist where email = 'sa-test-one@example.invalid'));
  perform public.signup_alerts_run(t0 + interval '30 minutes', 'log', null, null);
  perform pg_temp.rec('4 ... and sends nothing, even after the cap', '1', pg_temp.logged('waitlist')::text);

  -- 5 -----------------------------------------------------------------
  -- Reset the waitlist's clock: last email at t0+1m, counted through t0.
  update public.signup_alerts set last_sent_at = t0 + interval '1 minute', last_checked_at = t0, last_status = 'logged'
   where kind = 'waitlist';
  insert into public.waitlist (email, created_at) values
    ('sa-test-two@example.invalid',   t0 + interval '2 minutes'),
    ('sa-test-three@example.invalid', t0 + interval '3 minutes'),
    ('sa-test-four@example.invalid',  t0 + interval '4 minutes');
  perform public.signup_alerts_run(t0 + interval '6 minutes', 'log', null, null);
  perform pg_temp.rec('5 inside 15 minutes of the last email: nothing sent, the rows wait',
    '1 waiting: sent in the last 15 minutes ' || t0,
    pg_temp.logged('waitlist') || ' ' || pg_temp.state('waitlist') || ' '
      || (select last_checked_at from public.signup_alerts where kind = 'waitlist'));
  perform public.signup_alerts_run(t0 + interval '17 minutes', 'log', null, null);
  perform pg_temp.rec('5 after the window: ONE email for all three', '2', pg_temp.logged('waitlist')::text);
  perform pg_temp.rec('5 ... summarising them',
    '3 new waitlist signups in the last 15 minutes — ' || pg_temp.total('waitlist', t0 + interval '17 minutes')
      || ' so far.' || c_link,
    pg_temp.last_body('waitlist'));
  perform pg_temp.rec('5 ... subject', '3 new waitlist signups',
    (select subject from public.signup_alert_log where kind = 'waitlist' order by id desc limit 1));
  perform pg_temp.rec('5 ... counted through the last of them', (t0 + interval '4 minutes')::text,
    (select last_checked_at::text from public.signup_alerts where kind = 'waitlist'));

  -- 6 -----------------------------------------------------------------
  perform pg_temp.apply('sa-test-beta@example.invalid', 'Sa Testname', 'age_25_34');
  perform public.signup_alerts_run(t0 + interval '1 minute', 'log', null, null);
  perform pg_temp.rec('6 one new beta application: its own email',
    '1 New beta application — ' || pg_temp.total('beta_applications', t0 + interval '1 minute') || ' so far.' || c_link,
    pg_temp.logged('beta') || ' ' || pg_temp.last_body('beta'));
  perform pg_temp.apply('SA-TEST-BETA@example.invalid', 'Sa Testname Again', 'age_35_44');
  perform pg_temp.rec('6 the same email again replaced the answers, one row', '1 age_35_44',
    (select count(*) || ' ' || max(age_range) from public.beta_applications where email = 'sa-test-beta@example.invalid'));
  perform public.signup_alerts_run(t0 + interval '30 minutes', 'log', null, null);
  perform pg_temp.rec('6 ... and sends nothing', '1', pg_temp.logged('beta')::text);

  -- 7 -----------------------------------------------------------------
  insert into public.waitlist (email, created_at) values ('sa-test-five@example.invalid', t0 + interval '40 minutes');
  v_chk := (select last_checked_at from public.signup_alerts where kind = 'waitlist');
  perform public.signup_alerts_run(t0 + interval '41 minutes', 'send', null, 'delivered@resend.dev');
  perform pg_temp.rec('7 no key: nothing sent, the reason recorded, the row still uncounted',
    'skipped: no signup_alerts_resend_key true true',
    pg_temp.state('waitlist') || ' '
      || ((select pending_request_id from public.signup_alerts where kind = 'waitlist') is null)::text || ' '
      || ((select last_checked_at from public.signup_alerts where kind = 'waitlist') = v_chk)::text);
  perform public.signup_alerts_run(t0 + interval '41 minutes', 'send', 'test-key-not-real', '  ');
  perform pg_temp.rec('7 no recipient: the same, its own reason',
    'skipped: no signup_alerts_to true true',
    pg_temp.state('waitlist') || ' '
      || ((select pending_request_id from public.signup_alerts where kind = 'waitlist') is null)::text || ' '
      || ((select last_checked_at from public.signup_alerts where kind = 'waitlist') = v_chk)::text);
  perform pg_temp.rec('7 ... and neither wrote a log line', '2', pg_temp.logged('waitlist')::text);

  -- 8 -----------------------------------------------------------------
  perform public.signup_alerts_run(t0 + interval '41 minutes', 'send', 'test-key-not-real', 'delivered@resend.dev');
  select pending_request_id into v_req from public.signup_alerts where kind = 'waitlist';
  perform pg_temp.rec('8 send: one request queued, the rows pending, not yet counted',
    'sending true true ' || (t0 + interval '40 minutes'),
    pg_temp.state('waitlist') || ' ' || (v_req is not null)::text || ' '
      || ((select last_checked_at from public.signup_alerts where kind = 'waitlist') = v_chk)::text || ' '
      || (select pending_through from public.signup_alerts where kind = 'waitlist'));
  perform pg_temp.rec('8 ... a POST to Resend''s email API', 'POST https://api.resend.com/emails',
    (select method || ' ' || url from net.http_request_queue where id = v_req));
  perform pg_temp.rec('8 ... from hello@, to the recipient given, the alert as the text',
    'Sorrel <hello@mysorrel.com> ["delivered@resend.dev"] New waitlist signup',
    (select (convert_from(body, 'utf8')::jsonb ->> 'from') || ' ' || (convert_from(body, 'utf8')::jsonb -> 'to')::text
            || ' ' || (convert_from(body, 'utf8')::jsonb ->> 'subject')
       from net.http_request_queue where id = v_req));
  perform public.signup_alerts_run(t0 + interval '50 minutes', 'send', 'test-key-not-real', 'delivered@resend.dev');
  perform pg_temp.rec('8 while it''s in flight, a run does nothing', 'sending ' || v_req,
    pg_temp.state('waitlist') || ' ' || (select pending_request_id from public.signup_alerts where kind = 'waitlist'));

  -- 9 -----------------------------------------------------------------
  perform public.signup_alerts_settle('waitlist', 200, false, null, t0 + interval '42 minutes');
  perform pg_temp.rec('9 a 2xx: the rows are counted, nothing pending',
    'sent (HTTP 200) ' || (t0 + interval '40 minutes') || ' true',
    (select last_status || ' ' || last_checked_at || ' ' || (pending_request_id is null)::text
       from public.signup_alerts where kind = 'waitlist'));

  insert into public.waitlist (email, created_at) values ('sa-test-six@example.invalid', t0 + interval '60 minutes');
  perform public.signup_alerts_run(t0 + interval '61 minutes', 'send', 'test-key-not-real', 'delivered@resend.dev');
  v_chk := (select last_checked_at from public.signup_alerts where kind = 'waitlist');
  perform public.signup_alerts_settle('waitlist', 422, false, null, t0 + interval '62 minutes');
  perform pg_temp.rec('9 a non-2xx: not counted, the failure recorded', 'failed: HTTP 422 true true',
    (select last_status || ' ' || (last_checked_at = v_chk)::text || ' ' || (pending_request_id is null)::text
       from public.signup_alerts where kind = 'waitlist'));
  perform public.signup_alerts_run(t0 + interval '70 minutes', 'log', null, null);
  perform pg_temp.rec('9 ... the retry waits out the 15 minutes', 'waiting: sent in the last 15 minutes',
    pg_temp.state('waitlist'));
  perform public.signup_alerts_run(t0 + interval '77 minutes', 'log', null, null);
  perform pg_temp.rec('9 ... then sends it again', '3 New waitlist signup',
    pg_temp.logged('waitlist') || ' ' || (select subject from public.signup_alert_log where kind = 'waitlist' order by id desc limit 1));

  insert into public.waitlist (email, created_at) values ('sa-test-seven@example.invalid', t0 + interval '100 minutes');
  perform public.signup_alerts_run(t0 + interval '101 minutes', 'send', 'test-key-not-real', 'delivered@resend.dev');
  v_chk := (select last_checked_at from public.signup_alerts where kind = 'waitlist');
  perform public.signup_alerts_settle('waitlist', null, true, null, t0 + interval '102 minutes');
  perform pg_temp.rec('9 a timeout: not counted', 'failed: timed out true',
    (select last_status || ' ' || (last_checked_at = v_chk)::text from public.signup_alerts where kind = 'waitlist'));

  -- No response at all: a request queued here never runs (rolled back),
  -- so after an hour the run settles it as failed by itself.
  perform public.signup_alerts_run(t0 + interval '120 minutes', 'send', 'test-key-not-real', 'delivered@resend.dev');
  perform public.signup_alerts_run(t0 + interval '150 minutes', 'log', null, null);
  perform pg_temp.rec('9 no response, under an hour: still in flight, nothing else done', 'sending 3',
    pg_temp.state('waitlist') || ' ' || pg_temp.logged('waitlist'));
  perform public.signup_alerts_run(t0 + interval '190 minutes', 'log', null, null);
  -- Settled as failed (not counted), so the same run, in log mode, sends
  -- the row again: a fourth email, and nothing left pending.
  perform pg_temp.rec('9 no response after an hour: settled as failed, and the row sent again', '4 true logged',
    pg_temp.logged('waitlist') || ' '
      || ((select pending_request_id from public.signup_alerts where kind = 'waitlist') is null)::text || ' '
      || pg_temp.state('waitlist'));

  -- 10 ----------------------------------------------------------------
  select count(*) into v_n from public.signup_alert_log
   where subject || ' ' || body ~* '(sa-test|example\.invalid|testname|resend\.dev|@)'
      or body !~ ('^(New (waitlist signup|beta application) — [0-9]+ so far\.'
                  || '|[0-9]+ new (waitlist signups|beta applications) in the last [0-9]+ minutes? — [0-9]+ so far\.)'
                  || E'\n\nOpen Supabase to view: https://supabase\\.com/dashboard/projects$');
  perform pg_temp.rec('10 no logged email holds an address or name, and every one is counts + link only', '0',
    v_n::text);
  perform pg_temp.rec('10 ... and there were emails to check', 'true',
    ((select count(*) from public.signup_alert_log) >= 4)::text);
  select count(*) into v_n from net.http_request_queue
   where url = 'https://api.resend.com/emails'
     and convert_from(body, 'utf8') ~* '(sa-test|testname|example\.invalid)';
  perform pg_temp.rec('10 no queued request to Resend holds an address or name from the rows', '0', v_n::text);
  -- The identity arguments list the OUT parameters too: what goes in is a
  -- type and three numbers; what comes out is the subject and body.
  perform pg_temp.rec('10 signup_alert_text() is given numbers only, never a row',
    'p_kind text, p_new integer, p_total bigint, p_minutes integer, OUT subject text, OUT body text',
    pg_get_function_identity_arguments('public.signup_alert_text(text,integer,bigint,integer)'::regprocedure));
end
$$;

-- The summary is the LAST row. A run counts as passed only when it says
-- ALL PASS (CLAUDE.md): every row true AND sections 1-10 all present. A
-- run that errors part-way returns no rows at all.
with expected(s) as (select unnest(array['1','2','3','4','5','6','7','8','9','10'])),
tally as (
  select (select count(*) from sa_results)                as total,
         (select count(*) from sa_results where not pass) as failed,
         (select string_agg(e.s, ', ' order by e.s::int) from expected e
           where not exists (select 1 from sa_results r where split_part(r.check_, ' ', 1) = e.s)) as missing
)
select check_ as check, expected, actual, pass
  from (select seq, check_, expected, actual, pass from sa_results
        union all
        select 2147483647, 'SUMMARY', 'ALL PASS (every row true, sections 1-10 present)',
               t.total || ' rows, ' || t.failed || ' false'
                 || coalesce(', missing sections: ' || t.missing, '')
                 || ' -- ' || case when t.failed = 0 and t.missing is null then 'ALL PASS' else 'NOT PASSED' end,
               t.failed = 0 and t.missing is null
          from tally t) x
 order by seq;

rollback;
