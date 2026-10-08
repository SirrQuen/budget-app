-- =====================================================================
-- EverNest 03: signup pipeline
--
-- RUN AFTER 02_rls_policies.sql.
--
-- Closes the three gaps that stop the app working at all:
--
--   1. profiles.username / phone -- collected by the signup form, no
--      columns existed. Plus the grant extension that 02 makes necessary.
--   2. No trigger creating a profiles row from auth.users. Signup
--      succeeded in Auth, then every FK to profiles failed.
--   3. No default categories. A new account could not create a
--      transaction, so it could not create a budget. Dead-end onboarding.
--
-- Also adds the username -> email resolution needed by a login screen
-- that asks for a username rather than an email.
-- =====================================================================


-- =====================================================================
-- STEP 1 -- profiles.username and phone
--
-- username is NULLABLE on purpose. The trigger reads it from signup
-- metadata, and a NOT NULL would turn any client that forgets to send it
-- into a hard signup failure with an opaque error. Enforce presence in
-- the signup form; treat the DB constraint as a backstop.
--
-- Uniqueness is case-insensitive: "Matt" and "matt" must not be two
-- accounts. A plain UNIQUE would allow exactly that.
-- =====================================================================

alter table public.profiles
  add column if not exists username text,
  add column if not exists phone    text;

create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

alter table public.profiles
  drop constraint if exists profiles_username_format;
alter table public.profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[A-Za-z0-9_]{3,30}$');

-- Loose on purpose: E.164-ish, but phone formats vary enough that a
-- strict pattern rejects legitimate numbers. Validate properly client-side.
alter table public.profiles
  drop constraint if exists profiles_phone_format;
alter table public.profiles
  add constraint profiles_phone_format
  check (phone is null or phone ~ '^\+?[0-9 ()\-]{7,20}$');


-- =====================================================================
-- STEP 2 -- Extend the column-level UPDATE grant
--
-- REQUIRED. Migration 02 revoked table-level UPDATE on profiles and
-- granted it back on four named columns, to stop users writing their own
-- subscription_plan. New columns are NOT covered by that grant, so
-- without this block users cannot edit their username or phone and the
-- failure surfaces as a permission error far from its cause.
--
-- subscription_plan and subscription_status stay excluded. That is the
-- billing lockdown; do not add them here.
-- =====================================================================

revoke update on public.profiles from authenticated;
grant  update (first_name, last_name, username, phone, lastlogin, updated_at)
  on public.profiles to authenticated;


-- =====================================================================
-- STEP 3 -- Default category seed
--
-- Broken out as its own function so it can be called by the signup
-- trigger AND re-run for a user who somehow ended up without categories
-- (see step 6).
--
-- SECURITY DEFINER because it runs during auth.users insert, when
-- auth.uid() is not yet the new user and the RLS INSERT policies would
-- reject the rows. search_path is pinned to '' so every reference has to
-- be schema-qualified -- without that, a hostile search_path could
-- redirect these inserts.
--
-- Idempotent: does nothing if the user already has category groups.
-- =====================================================================

create or replace function public.seed_default_categories(p_userid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if exists (select 1 from public.category_groups where userid = p_userid) then
    return;
  end if;

  with g as (
    insert into public.category_groups (userid, name, sort_order)
    values
      (p_userid, 'Income',         0),
      (p_userid, 'Housing',        1),
      (p_userid, 'Transportation', 2),
      (p_userid, 'Food',           3),
      (p_userid, 'Personal',       4),
      (p_userid, 'Health',         5),
      (p_userid, 'Entertainment',  6),
      (p_userid, 'Financial',      7),
      (p_userid, 'Other',          8)
    returning id, name
  )
  insert into public.categories (userid, groupid, category_name, icon, color)
  select p_userid, g.id, v.category_name, v.icon, v.color
    from g
    join (values
      ('Income',         'Salary',            'banknote',        '#10B981'),
      ('Income',         'Bonus',             'gift',            '#10B981'),
      ('Income',         'Interest',          'percent',         '#10B981'),
      ('Income',         'Other Income',      'plus-circle',     '#10B981'),

      ('Housing',        'Rent / Mortgage',   'home',            '#F59E0B'),
      ('Housing',        'Utilities',         'zap',             '#F59E0B'),
      ('Housing',        'Home Maintenance',  'wrench',          '#F59E0B'),
      ('Housing',        'Home Insurance',    'shield',          '#F59E0B'),

      ('Transportation', 'Gas',               'fuel',            '#3B82F6'),
      ('Transportation', 'Car Payment',       'car',             '#3B82F6'),
      ('Transportation', 'Public Transit',    'train-front',     '#3B82F6'),
      ('Transportation', 'Parking',           'circle-parking',  '#3B82F6'),
      ('Transportation', 'Car Maintenance',   'wrench',          '#3B82F6'),

      ('Food',           'Groceries',         'shopping-cart',   '#EF4444'),
      ('Food',           'Restaurants',       'utensils',        '#EF4444'),
      ('Food',           'Coffee',            'coffee',          '#EF4444'),

      ('Personal',       'Clothing',          'shirt',           '#8B5CF6'),
      ('Personal',       'Personal Care',     'scissors',        '#8B5CF6'),
      ('Personal',       'Fitness',           'dumbbell',        '#8B5CF6'),
      ('Personal',       'Subscriptions',     'repeat',          '#8B5CF6'),

      ('Health',         'Medical',           'stethoscope',     '#EC4899'),
      ('Health',         'Dental',            'smile',           '#EC4899'),
      ('Health',         'Pharmacy',          'pill',            '#EC4899'),
      ('Health',         'Health Insurance',  'heart-pulse',     '#EC4899'),

      ('Entertainment',  'Streaming',         'tv',              '#06B6D4'),
      ('Entertainment',  'Hobbies',           'palette',         '#06B6D4'),
      ('Entertainment',  'Travel',            'plane',           '#06B6D4'),
      ('Entertainment',  'Events',            'ticket',          '#06B6D4'),

      ('Financial',      'Savings',           'piggy-bank',      '#14B8A6'),
      ('Financial',      'Investments',       'trending-up',     '#14B8A6'),
      ('Financial',      'Debt Payment',      'credit-card',     '#14B8A6'),
      ('Financial',      'Fees',              'receipt',         '#14B8A6'),

      ('Other',          'Gifts',             'gift',            '#6B7280'),
      ('Other',          'Charity',           'heart',           '#6B7280'),
      ('Other',          'Miscellaneous',     'circle-ellipsis', '#6B7280')
    ) as v(group_name, category_name, icon, color)
      on v.group_name = g.name;
end;
$fn$;

comment on function public.seed_default_categories(uuid) is
  'Creates the default category tree for a user. No-op if they already have groups.';


-- =====================================================================
-- STEP 4 -- handle_new_user trigger
--
-- Fires on auth.users INSERT and creates the profile, a settings row,
-- and the default categories.
--
-- FAILURE POLICY, deliberate:
--   * profile and settings are HARD requirements. If either fails the
--     whole signup is rolled back, because a user without a profile row
--     cannot do anything and would be a confusing orphan in auth.users.
--   * category seeding is SOFT. Wrapped in an exception block so a seed
--     problem cannot block account creation. Step 6 backfills anyone
--     affected, and the warning lands in your Postgres logs.
--
-- first_name / last_name are NOT NULL on profiles, so they fall back to
-- '' rather than aborting signup when metadata is missing.
--
-- Metadata keys expected from the client (see step 8):
--   first_name, last_name, username, phone
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.profiles (id, first_name, last_name, username, phone, lastlogin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name',  ''),
    nullif(new.raw_user_meta_data ->> 'username', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'phone', ''), new.phone),
    now()
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

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =====================================================================
-- STEP 5 -- Username helpers
--
-- profiles SELECT is self-only, so an anonymous visitor cannot check
-- whether a username exists or resolve one to an email. Both need
-- SECURITY DEFINER.
--
-- These two are granted very differently, on purpose.
-- =====================================================================

-- 5a. Availability check for the signup form.
-- Returns a boolean only. Any username system leaks existence by
-- definition -- that is what a uniqueness check IS -- so exposing this to
-- anon is acceptable. RATE LIMIT IT ANYWAY: without a limit it is a
-- fast enumeration endpoint.
create or replace function public.username_is_available(p_username text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $fn$
  select not exists (
    select 1 from public.profiles
     where lower(username) = lower(p_username)
  );
$fn$;

revoke all on function public.username_is_available(text) from public;
grant execute on function public.username_is_available(text) to anon, authenticated;


-- 5b. Username -> email resolution for login.
--
-- NOT granted to anon or authenticated. Deliberately.
--
-- This returns an EMAIL ADDRESS. Exposed to anon it becomes a PII
-- harvesting endpoint: guess usernames, collect real email addresses.
-- That is materially worse than existence disclosure.
--
-- Correct usage is an Edge Function holding the service_role key:
--   1. client posts { username, password } to the function
--   2. function calls email_for_username() server-side
--   3. function calls signInWithPassword(email, password)
--   4. function returns the session
-- The email never reaches the browser.
--
-- Return a single generic "invalid username or password" for every
-- failure path, so a bad username and a bad password are indistinguishable.
create or replace function public.email_for_username(p_username text)
returns text
language sql
security definer
set search_path = ''
stable
as $fn$
  select u.email
    from public.profiles p
    join auth.users u on u.id = p.id
   where lower(p.username) = lower(p_username)
   limit 1;
$fn$;

revoke all on function public.email_for_username(text) from public, anon, authenticated;
grant execute on function public.email_for_username(text) to service_role;


-- =====================================================================
-- STEP 6 -- Backfill existing users
--
-- Any account created before this migration has no profile, no settings,
-- and no categories. Covers your test users.
-- =====================================================================

begin;

insert into public.profiles (id, first_name, last_name, username, phone, lastlogin)
select u.id,
       coalesce(u.raw_user_meta_data ->> 'first_name', ''),
       coalesce(u.raw_user_meta_data ->> 'last_name',  ''),
       nullif(u.raw_user_meta_data ->> 'username', ''),
       coalesce(nullif(u.raw_user_meta_data ->> 'phone', ''), u.phone),
       now()
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);

insert into public.settings (userid)
select p.id
  from public.profiles p
 where not exists (select 1 from public.settings s where s.userid = p.id);

commit;

-- Seed categories for anyone missing them (idempotent per user).
do $do$
declare r record;
begin
  for r in
    select p.id from public.profiles p
     where not exists (
       select 1 from public.category_groups cg where cg.userid = p.id)
  loop
    perform public.seed_default_categories(r.id);
  end loop;
end
$do$;


-- =====================================================================
-- STEP 7 -- Verify
-- =====================================================================

-- (a) Trigger installed. Expect one row.
select tgname, tgrelid::regclass as on_table, tgenabled
  from pg_trigger
 where tgname = 'on_auth_user_created';

-- (b) Every auth user has a profile, settings, and categories.
-- All three counts must equal auth_users.
select (select count(*) from auth.users)                                  as auth_users,
       (select count(*) from public.profiles)                             as profiles,
       (select count(*) from public.settings)                             as settings,
       (select count(distinct userid) from public.category_groups)        as users_with_categories;

-- (c) Column grants: username and phone present, subscription_* absent.
select column_name
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'profiles'
   and grantee = 'authenticated' and privilege_type = 'UPDATE'
 order by 1;

-- (d) Function exposure. email_for_username must NOT list anon or
-- authenticated.
select p.proname,
       pg_get_userbyid(p.proowner) as owner,
       p.prosecdef                 as security_definer,
       p.proacl                    as grants
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('handle_new_user', 'seed_default_categories',
                     'username_is_available', 'email_for_username')
 order by 1;

-- (e) End-to-end: sign up a user through your app, then
-- select count(*) from public.categories where userid = '<new-user-id>';
-- Expect 35.


-- =====================================================================
-- STEP 8 -- Client-side contract
--
-- The trigger reads these keys from raw_user_meta_data. Send them at
-- signup or the profile lands with empty names and a null username:
--
--   await supabase.auth.signUp({
--     email, password,
--     options: { data: { first_name, last_name, username, phone } }
--   });
--
-- Note the signup form also collects a password confirmation and the
-- email; those stay in auth.users and are not mirrored into profiles.
-- =====================================================================


-- =====================================================================
-- KNOWN GAP -- categories have no income/expense flag
--
-- The seed creates an "Income" group, but `categories` has no column
-- marking a category as income vs expense. Consequences:
--
--   * The Budget screen will offer "Salary" as a budgetable category.
--   * v_category_spending filters on transaction_type = 'Expense', so
--     income categories correctly show no spend -- but they will still
--     appear in any category picker as valid expense targets.
--
-- The fix is a category_type column ('Income' | 'Expense') plus a CHECK
-- that a transaction's type matches its category's type. Out of scope
-- here, but worth doing before the Budget and Transactions screens are
-- built, since both will otherwise need client-side workarounds.
-- =====================================================================


-- =====================================================================
-- APPENDIX -- Rollback
-- =====================================================================

-- drop trigger if exists on_auth_user_created on auth.users;
-- drop function if exists public.handle_new_user();
-- drop function if exists public.email_for_username(text);
-- drop function if exists public.username_is_available(text);
-- drop function if exists public.seed_default_categories(uuid);
--
-- revoke update on public.profiles from authenticated;
-- grant  update (first_name, last_name, lastlogin, updated_at)
--   on public.profiles to authenticated;
--
-- alter table public.profiles drop constraint if exists profiles_phone_format;
-- alter table public.profiles drop constraint if exists profiles_username_format;
-- drop index if exists public.profiles_username_lower_key;
-- alter table public.profiles drop column if exists phone;
-- alter table public.profiles drop column if exists username;
