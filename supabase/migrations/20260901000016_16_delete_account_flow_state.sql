-- =====================================================================
-- 16 -- delete_own_account() also clears auth.flow_state
--
-- Verifying migration 14 end to end turned up one table that still held a
-- row for a deleted user: auth.flow_state. Unlike auth.sessions /
-- auth.identities / auth.one_time_tokens (all ON DELETE CASCADE from
-- auth.users), auth.flow_state has no FK to auth.users -- GoTrue treats
-- its rows as short-lived PKCE scratch space and prunes them on a timer.
-- They are not app data and carry no credentials, but "zero rows anywhere
-- referencing the user" should mean zero, so the function clears them too.
--
-- Everything else in 14 is unchanged; this is a straight redefinition with
-- one extra delete.
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
  -- its referencing rows still present (see 14 for the full reasoning).
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

  -- PKCE flow scratch rows -- no FK to auth.users, so not covered by the
  -- cascade below.
  delete from auth.flow_state where user_id = v_uid;

  -- The account itself. `id = v_uid` only -- never a passed-in id. Cascades
  -- to public.profiles (childless by now) and to auth.identities /
  -- auth.sessions / auth.one_time_tokens / auth.mfa_factors / the rest.
  delete from auth.users where id = v_uid;
end;
$fn$;

comment on function public.delete_own_account() is
  'Permanently deletes the calling user (auth.uid()): every owned row in public.*, their auth.flow_state rows, then their auth.users row, which cascades to profiles and the rest of auth.*. Irreversible, no backup. Takes no argument by design -- a caller can only delete themselves.';


-- =====================================================================
-- Verify
-- =====================================================================
-- After delete_own_account() runs for '<uid>', every uuid column across
-- schemas public and auth should return 0:
--
-- do $$
-- declare r record; c bigint; hit text := '';
-- begin
--   for r in select table_schema, table_name, column_name
--              from information_schema.columns
--             where table_schema in ('public','auth') and data_type = 'uuid'
--   loop
--     execute format('select count(*) from %I.%I where %I = %L',
--                    r.table_schema, r.table_name, r.column_name, '<uid>')
--       into c;
--     if c > 0 then hit := hit || format('%s.%s.%s=%s; ',
--       r.table_schema, r.table_name, r.column_name, c); end if;
--   end loop;
--   if hit = '' then raise notice 'CLEAN';
--   else raise exception 'RESIDUE: %', hit; end if;
-- end $$;


-- =====================================================================
-- Rollback -- restore the 14 body (no auth.flow_state delete)
-- =====================================================================
