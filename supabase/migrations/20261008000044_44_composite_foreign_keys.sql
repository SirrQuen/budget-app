-- =====================================================================
-- EverNest 44: composite foreign keys -- a child can only reference its
-- own user's parent
--
-- Launch blocker 1 (docs/phase-7-findings.md, "Cross-user foreign keys").
-- Every FK between user-owned tables was single-column, so nothing in the
-- schema stopped a row owned by B from pointing at A's account, category,
-- group, goal, schedule or transaction. One such row makes A's ON DELETE
-- RESTRICT parents -- and so delete_own_account() -- fail permanently.
--
-- Migration 37 closed this for PostgREST writes with an ownership EXISTS
-- in each WITH CHECK. That lives in RLS, so service_role, the table owner
-- and any SECURITY DEFINER function write straight past it. A foreign key
-- is enforced for every role in every context. The policies stay: the FK
-- is the guarantee, the policy is the early, legible error (RLS rejects
-- with 42501 before the FK check ever runs).
--
-- Shape: unique (userid, id) on each parent, then each child FK rewritten
-- as (userid, <ref>) -> parent(userid, id), keeping its constraint NAME
-- (PostgREST embeds by it -- lib/db/recurring.ts) and its ON DELETE
-- action. SET NULL FKs use the column-list form so the cascade nulls only
-- the reference, never userid (which is NOT NULL and the owner).
--
-- goal_contributions had no userid -- it belonged to its goal's owner --
-- so it gains one, backfilled from the goal. Both of its references then
-- take the same composite shape as everything else.
--
-- Before any constraint is added, the pre-flight below counts cross-user
-- rows for every reference and aborts with the counts if any exist. A
-- found row is exactly the stuck-deletion case and must be resolved by
-- hand, not by this migration. docs/cross-user-references-audit.sql
-- returned 0 on all 13 references against production on 2026-10-08.
--
-- Nullable references (categoryid on transfer legs, goalid, recurringid,
-- to_accountid, goals.accountid, transactionid) are MATCH SIMPLE: a null
-- reference is not checked, exactly as before.
--
-- docs/rls-isolation-test.sql section 8 asserts the FKs reject every
-- cross-user reference written as the table owner (RLS bypassed).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. goal_contributions.userid
-- ---------------------------------------------------------------------
alter table public.goal_contributions add column userid uuid;

update public.goal_contributions gc
   set userid = g.userid
  from public.goals g
 where g.id = gc.goalid;

alter table public.goal_contributions alter column userid set not null;

alter table public.goal_contributions
  add constraint goal_contributions_userid_fkey
  foreign key (userid) references public.profiles(id) on delete cascade;

create index idx_goal_contributions_userid on public.goal_contributions using btree (userid);


-- ---------------------------------------------------------------------
-- 2. Pre-flight: no existing row may violate a constraint added below
-- ---------------------------------------------------------------------
do $$
declare
  v_found text;
begin
  select string_agg(format('%s: %s', ref, n), '; ' order by ref) into v_found
    from (values
      ('transactions.accountid',              (select count(*) from public.transactions c           join public.accounts p               on p.id = c.accountid     where p.userid <> c.userid)),
      ('transactions.categoryid',             (select count(*) from public.transactions c           join public.categories p             on p.id = c.categoryid    where p.userid <> c.userid)),
      ('transactions.goalid',                 (select count(*) from public.transactions c           join public.goals p                  on p.id = c.goalid        where p.userid <> c.userid)),
      ('transactions.recurringid',            (select count(*) from public.transactions c           join public.recurring_transactions p on p.id = c.recurringid   where p.userid <> c.userid)),
      ('recurring_transactions.accountid',    (select count(*) from public.recurring_transactions c join public.accounts p               on p.id = c.accountid     where p.userid <> c.userid)),
      ('recurring_transactions.to_accountid', (select count(*) from public.recurring_transactions c join public.accounts p               on p.id = c.to_accountid  where p.userid <> c.userid)),
      ('recurring_transactions.categoryid',   (select count(*) from public.recurring_transactions c join public.categories p             on p.id = c.categoryid    where p.userid <> c.userid)),
      ('investments.accountid',               (select count(*) from public.investments c            join public.accounts p               on p.id = c.accountid     where p.userid <> c.userid)),
      ('budgets.categoryid',                  (select count(*) from public.budgets c                join public.categories p             on p.id = c.categoryid    where p.userid <> c.userid)),
      ('goals.accountid',                     (select count(*) from public.goals c                  join public.accounts p               on p.id = c.accountid     where p.userid <> c.userid)),
      ('categories.groupid',                  (select count(*) from public.categories c             join public.category_groups p        on p.id = c.groupid       where p.userid <> c.userid)),
      ('goal_contributions.goalid',           (select count(*) from public.goal_contributions c     join public.goals p                  on p.id = c.goalid        where p.userid <> c.userid)),
      ('goal_contributions.transactionid',    (select count(*) from public.goal_contributions c     join public.transactions p           on p.id = c.transactionid where p.userid <> c.userid))
    ) as t(ref, n)
   where n > 0;

  if v_found is not null then
    raise exception 'composite FKs: cross-user rows exist, resolve them first -- %', v_found
      using hint = 'npx supabase@latest db query --linked -f docs/cross-user-references-audit.sql lists the child ids.';
  end if;
end
$$;


-- ---------------------------------------------------------------------
-- 3. unique (userid, id) on every user-owned parent
-- ---------------------------------------------------------------------
alter table public.accounts               add constraint accounts_userid_id_key               unique (userid, id);
alter table public.categories             add constraint categories_userid_id_key             unique (userid, id);
alter table public.category_groups        add constraint category_groups_userid_id_key        unique (userid, id);
alter table public.goals                  add constraint goals_userid_id_key                  unique (userid, id);
alter table public.recurring_transactions add constraint recurring_transactions_userid_id_key unique (userid, id);
alter table public.transactions           add constraint transactions_userid_id_key           unique (userid, id);


-- ---------------------------------------------------------------------
-- 4. Child FKs rewritten as composite. Same names, same ON DELETE.
-- ---------------------------------------------------------------------

-- transactions
alter table public.transactions
  drop constraint transactions_accountid_fkey,
  add  constraint transactions_accountid_fkey
       foreign key (userid, accountid) references public.accounts(userid, id) on delete restrict,
  drop constraint transactions_categoryid_fkey,
  add  constraint transactions_categoryid_fkey
       foreign key (userid, categoryid) references public.categories(userid, id) on delete restrict,
  drop constraint transactions_goalid_fkey,
  add  constraint transactions_goalid_fkey
       foreign key (userid, goalid) references public.goals(userid, id) on delete set null (goalid),
  drop constraint transactions_recurringid_fkey,
  add  constraint transactions_recurringid_fkey
       foreign key (userid, recurringid) references public.recurring_transactions(userid, id) on delete set null (recurringid);

-- recurring_transactions
alter table public.recurring_transactions
  drop constraint recurring_transactions_accountid_fkey,
  add  constraint recurring_transactions_accountid_fkey
       foreign key (userid, accountid) references public.accounts(userid, id) on delete restrict,
  drop constraint recurring_transactions_to_accountid_fkey,
  add  constraint recurring_transactions_to_accountid_fkey
       foreign key (userid, to_accountid) references public.accounts(userid, id) on delete restrict,
  drop constraint recurring_transactions_categoryid_fkey,
  add  constraint recurring_transactions_categoryid_fkey
       foreign key (userid, categoryid) references public.categories(userid, id) on delete restrict;

-- investments
alter table public.investments
  drop constraint investments_accountid_fkey,
  add  constraint investments_accountid_fkey
       foreign key (userid, accountid) references public.accounts(userid, id) on delete restrict;

-- budgets
alter table public.budgets
  drop constraint budgets_categoryid_fkey,
  add  constraint budgets_categoryid_fkey
       foreign key (userid, categoryid) references public.categories(userid, id) on delete cascade;

-- goals
alter table public.goals
  drop constraint goals_accountid_fkey,
  add  constraint goals_accountid_fkey
       foreign key (userid, accountid) references public.accounts(userid, id) on delete set null (accountid);

-- categories
alter table public.categories
  drop constraint categories_groupid_fkey,
  add  constraint categories_groupid_fkey
       foreign key (userid, groupid) references public.category_groups(userid, id) on delete restrict;

-- goal_contributions
alter table public.goal_contributions
  drop constraint goal_contributions_goalid_fkey,
  add  constraint goal_contributions_goalid_fkey
       foreign key (userid, goalid) references public.goals(userid, id) on delete cascade,
  drop constraint goal_contributions_transactionid_fkey,
  add  constraint goal_contributions_transactionid_fkey
       foreign key (userid, transactionid) references public.transactions(userid, id) on delete cascade;


-- ---------------------------------------------------------------------
-- 5. goal_contributions policies: the new owner column must be the
--    caller, like every other table. Ownership EXISTS checks unchanged.
-- ---------------------------------------------------------------------
alter policy goal_contributions_insert_own on public.goal_contributions
  with check (
    userid = (select auth.uid())
    and exists (select 1 from public.goals g
                 where g.id = goal_contributions.goalid and g.userid = (select auth.uid()))
    and (transactionid is null
         or exists (select 1 from public.transactions t
                     where t.id = goal_contributions.transactionid and t.userid = (select auth.uid())))
  );

alter policy goal_contributions_update_own on public.goal_contributions
  with check (
    userid = (select auth.uid())
    and exists (select 1 from public.goals g
                 where g.id = goal_contributions.goalid and g.userid = (select auth.uid()))
    and (transactionid is null
         or exists (select 1 from public.transactions t
                     where t.id = goal_contributions.transactionid and t.userid = (select auth.uid())))
  );
