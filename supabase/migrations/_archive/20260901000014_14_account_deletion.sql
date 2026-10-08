-- =====================================================================
-- 14 -- self-service account deletion
--
-- delete_own_account() lets a signed-in user permanently erase themselves:
-- every row they own in public.*, then their auth.users row. Irreversible,
-- no backup kept.
--
-- SECURITY DEFINER, and it operates ONLY on auth.uid() -- it takes no
-- argument, so a caller can never delete anyone but themselves. The app
-- must never do this with the service_role key; this function is the whole
-- mechanism. EXECUTE is granted to `authenticated` only.
--
-- Why the explicit per-table deletes instead of leaning on
-- `delete from auth.users` alone:
--
--   auth.users -> profiles is ON DELETE CASCADE, and every public table's
--   userid -> profiles FK is CASCADE too, so in principle one delete would
--   clear everything. But the sibling FKs among a user's own rows are
--   ON DELETE RESTRICT (04_hardening step 6):
--
--     transactions.accountid   -> accounts        RESTRICT
--     transactions.categoryid  -> categories      RESTRICT
--     categories.groupid       -> category_groups RESTRICT
--     recurring_transactions.{accountid,categoryid}                RESTRICT
--     investments.accountid    -> accounts        RESTRICT
--
--   RESTRICT is checked immediately, never deferred. If the CASCADE from
--   profiles reaches `accounts` before it has cleared that user's
--   `transactions`, the RESTRICT check fires and the entire delete aborts.
--   Whether that happens depends on the order Postgres walks the FKs,
--   which is not something to depend on for an irreversible action. So we
--   delete children before parents ourselves and leave nothing for the
--   cascade to trip over.
-- =====================================================================

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'delete_own_account: no authenticated user';
  end if;

  -- children -> parents, so no ON DELETE RESTRICT FK is ever checked with
  -- its referencing rows still present.
  delete from public.goal_contributions
   where goalid in (select id from public.goals where userid = v_uid);

  delete from public.transactions            where userid = v_uid;
  delete from public.recurring_transactions  where userid = v_uid;
  delete from public.investments             where userid = v_uid;
  delete from public.budgets                 where userid = v_uid;
  delete from public.goals                   where userid = v_uid;
  delete from public.accounts                where userid = v_uid;
  delete from public.categories              where userid = v_uid;
  delete from public.category_groups         where userid = v_uid;
  delete from public.notifications           where userid = v_uid;
  delete from public.settings                where userid = v_uid;
  delete from public.subscriptions           where userid = v_uid;

  -- The account itself. `id = v_uid` only -- never a passed-in id. Cascades
  -- to public.profiles (childless by now) and to auth.identities /
  -- auth.sessions / auth.refresh_tokens.
  delete from auth.users where id = v_uid;
end;
$fn$;

comment on function public.delete_own_account() is
  'Permanently deletes the calling user (auth.uid()): every owned row in public.*, then their auth.users row, which cascades to profiles and auth.*. Irreversible, no backup. Takes no argument by design -- a caller can only delete themselves.';

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;


-- =====================================================================
-- Verify
-- =====================================================================

-- (a) Exposure: security_definer true, and proacl grants EXECUTE to
-- authenticated but NOT anon or public.
-- select p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner, p.proacl
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'delete_own_account';

-- (b) End to end: sign up a throwaway user through the app, add an
-- account, a few transactions, a budget and a goal, then call
--   select public.delete_own_account();
-- as that user and confirm every count below is 0:
-- select
--   (select count(*) from auth.users              where id     = '<uid>') as users,
--   (select count(*) from public.profiles         where id     = '<uid>') as profiles,
--   (select count(*) from public.accounts         where userid = '<uid>') as accounts,
--   (select count(*) from public.transactions     where userid = '<uid>') as transactions,
--   (select count(*) from public.categories       where userid = '<uid>') as categories,
--   (select count(*) from public.category_groups  where userid = '<uid>') as category_groups,
--   (select count(*) from public.budgets          where userid = '<uid>') as budgets,
--   (select count(*) from public.goals            where userid = '<uid>') as goals,
--   (select count(*) from public.settings         where userid = '<uid>') as settings,
--   (select count(*) from public.subscriptions    where userid = '<uid>') as subscriptions,
--   (select count(*) from public.notifications    where userid = '<uid>') as notifications,
--   (select count(*) from public.recurring_transactions where userid = '<uid>') as recurring,
--   (select count(*) from public.investments      where userid = '<uid>') as investments;


-- =====================================================================
-- Rollback
-- =====================================================================
-- drop function if exists public.delete_own_account();
