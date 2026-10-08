-- =====================================================================
-- EverNest 02: RLS policy rebuild
--
-- RUN AFTER 01_drop_families.sql.
--
-- Fixes, in order of severity:
--
--   1. BILLING BYPASS. subscriptions had INSERT/UPDATE/DELETE policies
--      scoped to the row owner, so any user could set their own
--      plan = 'Premium'. profiles.subscription_plan was equally writable
--      through the profiles UPDATE policy. Both are locked below:
--      billing state becomes service_role-only.
--
--   2. goal_contributions had RLS ENABLED and ZERO POLICIES. In Postgres
--      that is deny-all, so the table was unreadable and unwritable by
--      every normal user -- silently returning 0 contributions, which
--      would have made every goal show 0% complete forever.
--
--   3. auth.uid() was called bare in all 52 policies, causing per-row
--      re-evaluation. Wrapped as (select auth.uid()) it becomes an
--      InitPlan evaluated once per query. Largest single performance
--      win available on transactions.
--
--   4. Policies targeted {public} (which includes anon) rather than
--      {authenticated}.
--
-- The families policies are not recreated -- that table is gone.
-- =====================================================================


-- =====================================================================
-- STEP 1 -- Clear existing policies
--
-- Programmatic rather than 52 DROP statements: it cannot miss one, and
-- it is idempotent if you re-run the file.
-- =====================================================================

do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- =====================================================================
-- STEP 2 -- Standard owner-scoped tables
--
-- Nine tables share the identical shape: a userid column, full CRUD by
-- the owner. Generated in a loop so all nine are provably consistent --
-- a hand-written set is where a typo'd predicate hides. The table list
-- is the audit surface; read it carefully.
--
-- (select auth.uid()) is intentional, not stylistic. See note 3 above.
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'accounts', 'budgets', 'categories', 'category_groups', 'goals',
    'investments', 'recurring_transactions', 'settings', 'transactions'
  ] loop
    execute format($f$
      create policy %1$s_select_own on public.%1$I
        for select to authenticated
        using (userid = (select auth.uid()));

      create policy %1$s_insert_own on public.%1$I
        for insert to authenticated
        with check (userid = (select auth.uid()));

      create policy %1$s_update_own on public.%1$I
        for update to authenticated
        using (userid = (select auth.uid()))
        with check (userid = (select auth.uid()));

      create policy %1$s_delete_own on public.%1$I
        for delete to authenticated
        using (userid = (select auth.uid()));
    $f$, t);
  end loop;
end $$;


-- =====================================================================
-- STEP 3 -- goal_contributions
--
-- Had no policies at all. It carries no userid of its own, so ownership
-- is derived through the parent goal. goals.id is the primary key, so
-- each EXISTS is a single index lookup.
--
-- WITH CHECK on insert/update prevents attaching a contribution to
-- someone else's goal.
-- =====================================================================

create policy goal_contributions_select_own on public.goal_contributions
  for select to authenticated
  using (exists (
    select 1 from goals g
     where g.id = goal_contributions.goalid
       and g.userid = (select auth.uid())));

create policy goal_contributions_insert_own on public.goal_contributions
  for insert to authenticated
  with check (exists (
    select 1 from goals g
     where g.id = goal_contributions.goalid
       and g.userid = (select auth.uid())));

create policy goal_contributions_update_own on public.goal_contributions
  for update to authenticated
  using (exists (
    select 1 from goals g
     where g.id = goal_contributions.goalid
       and g.userid = (select auth.uid())))
  with check (exists (
    select 1 from goals g
     where g.id = goal_contributions.goalid
       and g.userid = (select auth.uid())));

create policy goal_contributions_delete_own on public.goal_contributions
  for delete to authenticated
  using (exists (
    select 1 from goals g
     where g.id = goal_contributions.goalid
       and g.userid = (select auth.uid())));


-- =====================================================================
-- STEP 4 -- notifications
--
-- No INSERT policy: a user has no business creating their own
-- notifications. They are written by your backend as service_role,
-- which bypasses RLS entirely.
--
-- UPDATE is kept for marking read, DELETE for dismissing.
-- =====================================================================

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (userid = (select auth.uid()));

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (userid = (select auth.uid()))
  with check (userid = (select auth.uid()));

create policy notifications_delete_own on public.notifications
  for delete to authenticated
  using (userid = (select auth.uid()));


-- =====================================================================
-- STEP 5 -- subscriptions  (READ ONLY for users)
--
-- SELECT only. No INSERT, UPDATE or DELETE policy exists, so those are
-- denied for every authenticated user.
--
-- Your Stripe webhook must run with the service_role key, which bypasses
-- RLS. If it currently uses the anon key with a user session, it will
-- start failing here -- that is the bug being fixed, not a regression.
-- =====================================================================

create policy subscriptions_select_own on public.subscriptions
  for select to authenticated
  using (userid = (select auth.uid()));


-- =====================================================================
-- STEP 6 -- profiles
--
-- SELECT and UPDATE own row; INSERT own row (the signup trigger runs as
-- the new user). No DELETE -- account deletion should cascade from
-- auth.users, which happens at the FK level and bypasses RLS.
--
-- The subscription columns are protected by GRANT, not by policy: RLS
-- decides WHICH ROWS you may touch, never WHICH COLUMNS. Without the
-- grant restriction in step 7, this UPDATE policy lets any user set
-- their own subscription_plan = 'Premium'.
-- =====================================================================

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));


-- =====================================================================
-- STEP 7 -- Column-level grants
--
-- The other half of the billing lockdown. Revoke UPDATE on the whole
-- table, then grant it back only on user-editable columns.
--
-- !! MAINTENANCE HAZARD !!
-- This list is explicit. Any column you ADD to profiles later will NOT
-- be updatable until you add it here. When you add username and phone
-- for the signup screen, extend this grant or signup will fail with a
-- permission error that does not obviously point back to this file.
-- =====================================================================

revoke update on public.profiles from authenticated;
grant  update (first_name, last_name, lastlogin, updated_at)
  on public.profiles to authenticated;

-- Defense in depth: revoke the write grants Supabase issues by default,
-- so subscriptions is protected by both grants and policies.
revoke insert, update, delete on public.subscriptions from authenticated;

-- anon has no legitimate access to any of these tables. RLS already
-- denies it (no anon policies exist), but removing the grant means the
-- request is rejected before any policy is evaluated.
do $$
declare t text;
begin
  foreach t in array array[
    'accounts', 'budgets', 'categories', 'category_groups', 'goals',
    'goal_contributions', 'investments', 'notifications', 'profiles',
    'recurring_transactions', 'settings', 'subscriptions', 'transactions'
  ] loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;


-- =====================================================================
-- STEP 8 -- Verify
-- =====================================================================

-- (a) THE MOST IMPORTANT CHECK.
-- Any table listed here has RLS on and NO policies, which means
-- deny-all. This is exactly how goal_contributions was broken.
-- Must return zero rows.
select c.relname as table_with_rls_but_no_policies
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   and c.relrowsecurity
   and not exists (
     select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = c.relname)
 order by 1;

-- (b) No policy should still call auth.uid() bare. Postgres stores the
-- wrapped form as "( SELECT auth.uid() AS uid)", so anything matching
-- auth.uid() WITHOUT a preceding SELECT is unwrapped.
-- Must return zero rows.
select tablename, policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and (
     (qual       like '%auth.uid()%' and qual       not like '%SELECT auth.uid()%') or
     (with_check like '%auth.uid()%' and with_check not like '%SELECT auth.uid()%')
   )
 order by 1, 2;

-- (c) Everything should target {authenticated}, never {public}.
-- Must return zero rows.
select tablename, policyname, roles
  from pg_policies
 where schemaname = 'public' and roles::text like '%public%'
 order by 1, 2;

-- (d) Confirm subscriptions is read-only for users: expect exactly one
-- row, cmd = SELECT.
select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public' and tablename = 'subscriptions';

-- (e) Confirm the profiles column grant: subscription_plan and
-- subscription_status must NOT appear.
select column_name, privilege_type
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'profiles'
   and grantee = 'authenticated' and privilege_type = 'UPDATE'
 order by 1;

-- (f) Full policy listing for a final read-through.
select tablename, policyname, cmd, roles, qual, with_check
  from pg_policies where schemaname = 'public'
 order by tablename, cmd, policyname;


-- =====================================================================
-- STEP 9 -- Manual test
--
-- Static inspection cannot prove isolation. Create two users through
-- your signup flow, give each an account and a transaction, then, as
-- user A's JWT:
--
--   select count(*) from transactions;      -- only A's rows
--   select count(*) from v_dashboard_kpis;  -- exactly 1 row, A's
--   update subscriptions set plan = 'Premium' where userid = <A>;
--                                           -- must fail or affect 0 rows
--   update profiles set subscription_plan = 'Premium' where id = <A>;
--                                           -- must fail: no column privilege
--   select * from goal_contributions;       -- A's contributions, not empty
--
-- The two subscription statements failing is the point of this file.
-- The last one returning rows is the goal_contributions fix.
-- =====================================================================


-- =====================================================================
-- STILL OUTSTANDING (not addressed here)
--
--   * No trigger creating a profiles row when auth.users gets one.
--     Signup succeeds in Auth, then every FK to profiles fails.
--   * No default category_groups / categories for new users, so a fresh
--     account cannot create a transaction, so it cannot create a budget.
--   * profiles.username and phone: collected by the signup form, no
--     columns exist. Username login also needs a SECURITY DEFINER
--     lookup, since profiles SELECT is self-only.
--   * Remaining CHECK constraints (transaction_type, asset_type,
--     frequency, subscription plan/status, settings ranges, amounts).
--   * ON DELETE rules never confirmed.
--   * updated_at triggers: the columns exist, nothing maintains them.
--   * goal_contributions.transactionid still NOT NULL, which blocks
--     tracking_method = 'Manual'.
-- =====================================================================
