-- =====================================================================
-- EverNest 37: WITH CHECK requires the user to own every parent row
--
-- Every INSERT/UPDATE policy checked only the row's own owner
-- (userid = auth.uid()). A foreign key check bypasses RLS, so a user
-- could insert a row of THEIR OWN that points at ANOTHER user's account,
-- category, group, goal, schedule or transaction -- confirmed by section
-- 4 of docs/rls-isolation-test.sql (11 references, all accepted). The
-- victim's figures were unaffected (the views are security_invoker), but
-- the attacker could:
--   * make the victim's ON DELETE RESTRICT parents undeletable, including
--     by delete_own_account();
--   * have ON DELETE CASCADE children removed by the victim's actions;
--   * probe whether a guessed id exists.
--
-- Each affected WITH CHECK now also requires every non-null reference to
-- resolve to a row the current user owns. USING clauses are unchanged.
--
-- Deliberately NOT checked: is_active. Editing a transaction on an
-- archived account, or an old budget on an archived category, is
-- legitimate. Nullable references (transfer legs have no categoryid) pass
-- when null.
--
-- This closes the hole for the only reachable surface: authenticated
-- users through PostgREST. It lives in RLS, so anything that bypasses RLS
-- (service_role, any future SECURITY DEFINER function) is not covered.
-- Composite foreign keys -- (parent_id, userid) -> parent(id, userid) --
-- are the structural fix and remain a launch blocker; see
-- docs/phase-7-findings.md.
--
-- docs/rls-isolation-test.sql section 4 asserts the cross-user case;
-- section 6 asserts the same-user writes this must not break.
-- =====================================================================


-- transactions: accountid, categoryid, goalid, recurringid
alter policy transactions_insert_own on public.transactions
  with check (
    userid = (select auth.uid())
    and exists (select 1 from public.accounts a
                 where a.id = transactions.accountid and a.userid = (select auth.uid()))
    and (transactions.categoryid is null
         or exists (select 1 from public.categories c
                     where c.id = transactions.categoryid and c.userid = (select auth.uid())))
    and (transactions.goalid is null
         or exists (select 1 from public.goals g
                     where g.id = transactions.goalid and g.userid = (select auth.uid())))
    and (transactions.recurringid is null
         or exists (select 1 from public.recurring_transactions r
                     where r.id = transactions.recurringid and r.userid = (select auth.uid())))
  );

alter policy transactions_update_own on public.transactions
  with check (
    userid = (select auth.uid())
    and exists (select 1 from public.accounts a
                 where a.id = transactions.accountid and a.userid = (select auth.uid()))
    and (transactions.categoryid is null
         or exists (select 1 from public.categories c
                     where c.id = transactions.categoryid and c.userid = (select auth.uid())))
    and (transactions.goalid is null
         or exists (select 1 from public.goals g
                     where g.id = transactions.goalid and g.userid = (select auth.uid())))
    and (transactions.recurringid is null
         or exists (select 1 from public.recurring_transactions r
                     where r.id = transactions.recurringid and r.userid = (select auth.uid())))
  );


-- recurring_transactions: accountid, to_accountid, categoryid
alter policy recurring_transactions_insert_own on public.recurring_transactions
  with check (
    userid = (select auth.uid())
    and exists (select 1 from public.accounts a
                 where a.id = recurring_transactions.accountid and a.userid = (select auth.uid()))
    and (recurring_transactions.to_accountid is null
         or exists (select 1 from public.accounts a
                     where a.id = recurring_transactions.to_accountid and a.userid = (select auth.uid())))
    and (recurring_transactions.categoryid is null
         or exists (select 1 from public.categories c
                     where c.id = recurring_transactions.categoryid and c.userid = (select auth.uid())))
  );

alter policy recurring_transactions_update_own on public.recurring_transactions
  with check (
    userid = (select auth.uid())
    and exists (select 1 from public.accounts a
                 where a.id = recurring_transactions.accountid and a.userid = (select auth.uid()))
    and (recurring_transactions.to_accountid is null
         or exists (select 1 from public.accounts a
                     where a.id = recurring_transactions.to_accountid and a.userid = (select auth.uid())))
    and (recurring_transactions.categoryid is null
         or exists (select 1 from public.categories c
                     where c.id = recurring_transactions.categoryid and c.userid = (select auth.uid())))
  );


-- budgets: categoryid
alter policy budgets_insert_own on public.budgets
  with check (
    userid = (select auth.uid())
    and exists (select 1 from public.categories c
                 where c.id = budgets.categoryid and c.userid = (select auth.uid()))
  );

alter policy budgets_update_own on public.budgets
  with check (
    userid = (select auth.uid())
    and exists (select 1 from public.categories c
                 where c.id = budgets.categoryid and c.userid = (select auth.uid()))
  );


-- categories: groupid
alter policy categories_insert_own on public.categories
  with check (
    userid = (select auth.uid())
    and exists (select 1 from public.category_groups g
                 where g.id = categories.groupid and g.userid = (select auth.uid()))
  );

alter policy categories_update_own on public.categories
  with check (
    userid = (select auth.uid())
    and exists (select 1 from public.category_groups g
                 where g.id = categories.groupid and g.userid = (select auth.uid()))
  );


-- investments: accountid
alter policy investments_insert_own on public.investments
  with check (
    userid = (select auth.uid())
    and exists (select 1 from public.accounts a
                 where a.id = investments.accountid and a.userid = (select auth.uid()))
  );

alter policy investments_update_own on public.investments
  with check (
    userid = (select auth.uid())
    and exists (select 1 from public.accounts a
                 where a.id = investments.accountid and a.userid = (select auth.uid()))
  );


-- goals: accountid
alter policy goals_insert_own on public.goals
  with check (
    userid = (select auth.uid())
    and (goals.accountid is null
         or exists (select 1 from public.accounts a
                     where a.id = goals.accountid and a.userid = (select auth.uid())))
  );

alter policy goals_update_own on public.goals
  with check (
    userid = (select auth.uid())
    and (goals.accountid is null
         or exists (select 1 from public.accounts a
                     where a.id = goals.accountid and a.userid = (select auth.uid())))
  );


-- goal_contributions: goalid (already checked), transactionid
alter policy goal_contributions_insert_own on public.goal_contributions
  with check (
    exists (select 1 from public.goals g
             where g.id = goal_contributions.goalid and g.userid = (select auth.uid()))
    and (goal_contributions.transactionid is null
         or exists (select 1 from public.transactions t
                     where t.id = goal_contributions.transactionid and t.userid = (select auth.uid())))
  );

alter policy goal_contributions_update_own on public.goal_contributions
  with check (
    exists (select 1 from public.goals g
             where g.id = goal_contributions.goalid and g.userid = (select auth.uid()))
    and (goal_contributions.transactionid is null
         or exists (select 1 from public.transactions t
                     where t.id = goal_contributions.transactionid and t.userid = (select auth.uid())))
  );
