-- =====================================================================
-- Sorrel 75: beta tester applications
--
-- /beta's form (docs/Beta-Application.md). The waitlist pattern
-- (migration 51), reused: an operator-only table written by one
-- SECURITY DEFINER function that anon may call and nobody else.
--
-- What is stored: a name, an email, one fixed code per question (the
-- "pick all that apply" question is a text array of codes), when consent
-- was given, and created_at/updated_at. Nothing else: no IP address, no
-- user agent, no referrer, no link to auth.users or any app table.
--
-- 1. Nobody but the operator reads it. RLS is on with NO policies, and
--    every table privilege is revoked from public, anon, authenticated
--    and service_role (dev's stock default privileges would otherwise
--    grant them ALL; nothing in the app uses service_role, and the
--    dashboard reads as postgres).
--
-- 2. Every coded answer is checked against its list by a constraint, so
--    the database refuses a code that isn't on it, whatever the caller.
--    The lists are lib/betaApplication.ts's; lib/betaApplication.test.ts
--    reads them back out of this file, so change both together. Each
--    constraint is written `check (<column> in (...))` -- or `<@ array[...]`
--    for the array -- one code per quoted string, for that test to parse.
--
-- 3. A repeat email looks exactly like a new one. submit_beta_application()
--    upserts on the email and returns void either way: a repeat replaces
--    that application's answers and says nothing about there having been
--    one. The constraints are checked on the proposed row before the
--    conflict is resolved, so an invalid code fails identically for a new
--    and a repeat email.
--
-- 4. The waitlist's rate limit: a global ceiling of 100 writes in any
--    rolling hour, checked BEFORE the write, so it can't depend on whether
--    the email has applied. Counted on updated_at, not created_at, so a
--    flood of repeats is bounded too (updated_at >= created_at, so new rows
--    are counted as well).
--
-- 5. Honeypot. p_website is a field a person never sees. Filled in, the
--    function returns exactly as on success and stores nothing -- before
--    any other check, so a bot learns nothing from the answer either.
--
-- Grants: migration 71/72's full block for the function -- revoke from all
-- four roles, then EXECUTE to exactly who calls it: anon. A signed-in
-- visitor never reaches /beta (the proxy sends it to /dashboard, as it
-- does "/"), so authenticated has no use for it.
-- =====================================================================

create table public.beta_applications (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  full_name     text not null,
  age_range     text not null,
  describes     text not null,
  experience    text not null,
  money_methods text[] not null,
  challenge     text not null,
  want          text not null,
  availability  text not null,
  comfortable   text not null,
  frequency     text not null,
  reason        text not null,
  consented_at  timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint beta_applications_email_normalised check (email = lower(btrim(email))),
  constraint beta_applications_email_shape check (
    char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint beta_applications_full_name_shape check (
    full_name = btrim(full_name) and char_length(full_name) between 1 and 100
  ),

  constraint beta_applications_age_range_check check (age_range in (
    'age_18_24', 'age_25_34', 'age_35_44', 'age_45_54', 'age_55_plus'
  )),
  constraint beta_applications_describes_check check (describes in (
    'describes_young_adult', 'describes_working_professional', 'describes_household',
    'describes_experienced_budgeter', 'describes_small_business', 'describes_new_to_budgeting',
    'describes_other'
  )),
  constraint beta_applications_experience_check check (experience in (
    'experience_beginner', 'experience_some', 'experience_experienced', 'experience_very'
  )),
  -- Every element on the list, at least one, no nulls, no repeats (six
  -- codes, so a distinct set has at most six; the function de-duplicates).
  constraint beta_applications_money_methods_check check (
    money_methods <@ array[
      'method_spreadsheet', 'method_app', 'method_paper', 'method_banking_app',
      'method_none', 'method_other'
    ]::text[]
    and cardinality(money_methods) between 1 and 6
    and array_position(money_methods, null) is null
  ),
  constraint beta_applications_challenge_check check (challenge in (
    'challenge_safe_to_spend', 'challenge_tracking', 'challenge_sticking', 'challenge_bills',
    'challenge_saving', 'challenge_debt', 'challenge_variable_income', 'challenge_other'
  )),
  constraint beta_applications_want_check check (want in (
    'want_safe_to_spend', 'want_plan_bills', 'want_all_accounts', 'want_savings',
    'want_pay_debt', 'want_less_stress', 'want_habits', 'want_other'
  )),
  constraint beta_applications_availability_check check (availability in (
    'available_yes', 'available_possibly', 'available_no'
  )),
  constraint beta_applications_comfortable_check check (comfortable in (
    'comfortable_yes', 'comfortable_no'
  )),
  constraint beta_applications_frequency_check check (frequency in (
    'frequency_daily', 'frequency_few_weekly', 'frequency_weekly', 'frequency_not_sure'
  )),
  constraint beta_applications_reason_check check (reason in (
    'reason_better_way', 'reason_try_early', 'reason_shape_product', 'reason_safe_to_spend',
    'reason_recommended', 'reason_other'
  ))
);

comment on table public.beta_applications is
  'Beta tester applications from /beta (migration 75). Operator-only: no RLS policy, no table grant to any API role. Written only by submit_beta_application(). Not linked to any account. Retention: see the privacy policy.';

-- The rate limit's window scan.
create index beta_applications_updated_at_idx on public.beta_applications (updated_at);

alter table public.beta_applications enable row level security;

revoke all on table public.beta_applications from public, anon, authenticated, service_role;

create function public.submit_beta_application(
  p_email         text,
  p_full_name     text,
  p_age_range     text,
  p_describes     text,
  p_experience    text,
  p_money_methods text[],
  p_challenge     text,
  p_want          text,
  p_availability  text,
  p_comfortable   text,
  p_frequency     text,
  p_reason        text,
  p_consent       boolean,
  p_website       text
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_email   text := lower(btrim(p_email));
  v_name    text := btrim(p_full_name);
  v_methods text[];
begin
  -- The honeypot, first: the normal answer, nothing stored.
  if nullif(btrim(p_website), '') is not null then
    return;
  end if;

  -- The same address rule as join_waitlist() and lib/waitlistValidation.ts.
  if v_email is null
     or char_length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'not a plausible email address' using errcode = '22023';
  end if;

  if v_name is null or char_length(v_name) = 0 or char_length(v_name) > 100 then
    raise exception 'full name must be 1 to 100 characters' using errcode = '22023';
  end if;

  if p_consent is not true then
    raise exception 'consent is required' using errcode = '22023';
  end if;

  -- The waitlist's ceiling. Before the write, so it never depends on
  -- whether this email has already applied.
  if (select count(*) from public.beta_applications
       where updated_at > now() - interval '1 hour') >= 100 then
    raise exception 'beta_rate_limited' using errcode = 'P0001';
  end if;

  -- Order kept, repeats dropped. Codes themselves are the constraints' job.
  select coalesce(array_agg(m order by first_at), '{}')
    into v_methods
    from (select m, min(ord) as first_at
            from unnest(p_money_methods) with ordinality as u(m, ord)
           group by m) d;

  insert into public.beta_applications as b (
    email, full_name, age_range, describes, experience, money_methods,
    challenge, want, availability, comfortable, frequency, reason,
    consented_at
  ) values (
    v_email, v_name, p_age_range, p_describes, p_experience, v_methods,
    p_challenge, p_want, p_availability, p_comfortable, p_frequency, p_reason,
    now()
  )
  on conflict (email) do update set
    full_name     = excluded.full_name,
    age_range     = excluded.age_range,
    describes     = excluded.describes,
    experience    = excluded.experience,
    money_methods = excluded.money_methods,
    challenge     = excluded.challenge,
    want          = excluded.want,
    availability  = excluded.availability,
    comfortable   = excluded.comfortable,
    frequency     = excluded.frequency,
    reason        = excluded.reason,
    consented_at  = excluded.consented_at,
    updated_at    = now();
end
$$;

comment on function public.submit_beta_application(text, text, text, text, text, text[], text, text, text, text, text, text, boolean, text) is
  'The only way into beta_applications (migration 75). anon only. Returns void whether the email is new or repeat (a repeat replaces that application). Honeypot p_website filled: returns, stores nothing. Rate limit: 100 writes per rolling hour, P0001 beta_rate_limited.';

revoke all on function public.submit_beta_application(text, text, text, text, text, text[], text, text, text, text, text, text, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_beta_application(text, text, text, text, text, text[], text, text, text, text, text, text, boolean, text)
  to anon;
