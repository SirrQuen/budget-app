-- =====================================================================
-- Sorrel 78: beta applications in plain English, for the dashboard
--
-- public.beta_applications_readable: one row per application, newest
-- first, every stored code shown as the /beta form's EXACT wording, times
-- in America/New_York ("2026-11-21 3:42 PM"), plus submitted_at (the raw
-- timestamp) for sorting in the Table Editor. Read-only by nature (a view
-- over a join of a values list); no data changes, no new table.
--
-- WHO CAN READ IT: only the owner, the postgres role the Supabase
-- dashboard's Table Editor and SQL Editor run as. ALL privileges are
-- revoked from public, anon, authenticated and service_role, so it is
-- never reachable through the API. This deliberately departs from
-- CLAUDE.md's view grant block (migration 57), which grants SELECT to
-- authenticated: that block is for views over a user's own data.
-- beta_applications is operator-only (migration 75), and so is this.
-- docs/view-acl-check.sql names it as the one operator-only view and
-- checks it against the owner-only ACL instead.
-- security_invoker = true all the same: a SELECT reads beta_applications
-- as the caller, and only the owner may read that table.
--
-- The labels live in two places, lib/betaApplication.ts (the form) and
-- the values list below. lib/betaApplicationReadable.test.ts reads this
-- file and fails if any field, code or label differs in either direction.
-- A code with no label shows as "[unknown: <code>]", never hidden, never
-- null.
-- =====================================================================

create view public.beta_applications_readable
with (security_invoker = true)
as
with labels(field, code, label) as (
  values
      ('age_range', 'age_18_24', '18–24'),
      ('age_range', 'age_25_34', '25–34'),
      ('age_range', 'age_35_44', '35–44'),
      ('age_range', 'age_45_54', '45–54'),
      ('age_range', 'age_55_plus', '55+'),
      ('describes', 'describes_young_adult', 'Young adult'),
      ('describes', 'describes_working_professional', 'Working professional'),
      ('describes', 'describes_household', 'Parent or managing household finances'),
      ('describes', 'describes_experienced_budgeter', 'Experienced budgeter'),
      ('describes', 'describes_small_business', 'Small business owner'),
      ('describes', 'describes_new_to_budgeting', 'New to budgeting'),
      ('describes', 'describes_other', 'Other'),
      ('experience', 'experience_beginner', 'Beginner'),
      ('experience', 'experience_some', 'Some experience'),
      ('experience', 'experience_experienced', 'Experienced'),
      ('experience', 'experience_very', 'Very experienced'),
      ('money_methods', 'method_spreadsheet', 'Spreadsheet'),
      ('money_methods', 'method_app', 'Budgeting app or software'),
      ('money_methods', 'method_paper', 'Paper or notebook'),
      ('money_methods', 'method_banking_app', 'Banking app'),
      ('money_methods', 'method_none', 'I don''t follow a budget right now'),
      ('money_methods', 'method_other', 'Other'),
      ('challenge', 'challenge_safe_to_spend', 'Knowing how much I can safely spend'),
      ('challenge', 'challenge_tracking', 'Keeping track of where my money goes'),
      ('challenge', 'challenge_sticking', 'Sticking to a budget'),
      ('challenge', 'challenge_bills', 'Bills and due dates sneaking up on me'),
      ('challenge', 'challenge_saving', 'Saving toward a goal'),
      ('challenge', 'challenge_debt', 'Paying down debt'),
      ('challenge', 'challenge_variable_income', 'Income that changes from month to month'),
      ('challenge', 'challenge_other', 'Other'),
      ('want', 'want_safe_to_spend', 'Know what''s safe to spend, day to day'),
      ('want', 'want_plan_bills', 'Plan ahead for upcoming bills'),
      ('want', 'want_all_accounts', 'See all my accounts in one place'),
      ('want', 'want_savings', 'Build savings toward a goal'),
      ('want', 'want_pay_debt', 'Pay off debt'),
      ('want', 'want_less_stress', 'Feel less stressed about money'),
      ('want', 'want_habits', 'Build better money habits'),
      ('want', 'want_other', 'Other'),
      ('availability', 'available_yes', 'Yes'),
      ('availability', 'available_possibly', 'Possibly'),
      ('availability', 'available_no', 'No'),
      ('comfortable', 'comfortable_yes', 'Yes'),
      ('comfortable', 'comfortable_no', 'No'),
      ('frequency', 'frequency_daily', 'Daily'),
      ('frequency', 'frequency_few_weekly', 'A few times a week'),
      ('frequency', 'frequency_weekly', 'Once a week'),
      ('frequency', 'frequency_not_sure', 'Not sure'),
      ('reason', 'reason_better_way', 'I want a better way to manage my money'),
      ('reason', 'reason_try_early', 'I like trying new apps early'),
      ('reason', 'reason_shape_product', 'I want to help shape a new product'),
      ('reason', 'reason_safe_to_spend', 'The “safe to spend” idea caught my eye'),
      ('reason', 'reason_recommended', 'Someone recommended Sorrel to me'),
      ('reason', 'reason_other', 'Other')
)
select
  to_char(b.created_at at time zone 'America/New_York', 'YYYY-MM-DD FMHH12:MI AM') as submitted,
  -- The same moment as a real timestamp, so the Table Editor's Sort orders
  -- it correctly ("submitted" is text: "3:42 PM" sorts before "9:10 AM").
  b.created_at as submitted_at,
  to_char(b.updated_at at time zone 'America/New_York', 'YYYY-MM-DD FMHH12:MI AM') as last_updated,
  b.full_name,
  b.email,
  coalesce((select l.label from labels l where l.field = 'age_range' and l.code = b.age_range),
           '[unknown: ' || coalesce(b.age_range, 'null') || ']') as age_range,
  coalesce((select l.label from labels l where l.field = 'describes' and l.code = b.describes),
           '[unknown: ' || coalesce(b.describes, 'null') || ']') as describes_you,
  coalesce((select l.label from labels l where l.field = 'experience' and l.code = b.experience),
           '[unknown: ' || coalesce(b.experience, 'null') || ']') as budgeting_experience,
  coalesce(
    (select string_agg(coalesce(l.label, '[unknown: ' || coalesce(m.code, 'null') || ']'), ', ' order by m.ord)
       from unnest(b.money_methods) with ordinality as m(code, ord)
       left join labels l on l.field = 'money_methods' and l.code = m.code),
    '[unknown: none]') as manages_money,
  coalesce((select l.label from labels l where l.field = 'challenge' and l.code = b.challenge),
           '[unknown: ' || coalesce(b.challenge, 'null') || ']') as biggest_challenge,
  coalesce((select l.label from labels l where l.field = 'want' and l.code = b.want),
           '[unknown: ' || coalesce(b.want, 'null') || ']') as wants_help_with,
  coalesce((select l.label from labels l where l.field = 'availability' and l.code = b.availability),
           '[unknown: ' || coalesce(b.availability, 'null') || ']') as can_commit_3_4_weeks,
  coalesce((select l.label from labels l where l.field = 'comfortable' and l.code = b.comfortable),
           '[unknown: ' || coalesce(b.comfortable, 'null') || ']') as comfortable_giving_feedback,
  coalesce((select l.label from labels l where l.field = 'frequency' and l.code = b.frequency),
           '[unknown: ' || coalesce(b.frequency, 'null') || ']') as expected_use,
  coalesce((select l.label from labels l where l.field = 'reason' and l.code = b.reason),
           '[unknown: ' || coalesce(b.reason, 'null') || ']') as why_join,
  to_char(b.consented_at at time zone 'America/New_York', 'YYYY-MM-DD FMHH12:MI AM') as consented_at
from public.beta_applications b
order by b.created_at desc, b.id;

comment on view public.beta_applications_readable is
  'Beta applications in plain English for the operator, newest first: each code as the /beta form words it (lib/betaApplication.ts; lib/betaApplicationReadable.test.ts keeps the two identical), an unknown code as "[unknown: <code>]", times in America/New_York. Readable only by its owner (the dashboard''s postgres role): every privilege revoked from public, anon, authenticated and service_role, so never through the API. security_invoker (migration 78).';

-- Owner only. Not migration 57's block: no API role reads this view.
revoke all on table public.beta_applications_readable from public, anon, authenticated, service_role;
