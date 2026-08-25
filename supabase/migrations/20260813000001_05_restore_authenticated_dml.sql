-- =====================================================================
-- 05: Restore DML grants to `authenticated` on base tables
--
-- Postgres gates table access twice: GRANT decides whether a role may
-- touch a table at all, RLS decides which rows. A prior hardening pass
-- revoked SELECT/INSERT/UPDATE/DELETE from `authenticated` on every base
-- table, leaving 52 correct RLS policies guarding tables nobody could
-- reach. Symptom: "permission denied for table transactions" for a user
-- reading their own rows.
--
-- These grants reopen gate 1 only. Row scoping remains entirely with the
-- RLS policies from migration 02 -- nothing here widens what any user
-- can see.
--
-- Deliberate exceptions from 02 and 03 are preserved:
--   profiles      SELECT + column-level UPDATE only (billing lockdown)
--   subscriptions SELECT only (service_role writes billing state)
--   anon          nothing, anywhere
-- =====================================================================

do $do$
declare t text;
begin
  foreach t in array array[
    'accounts','budgets','categories','category_groups','goal_contributions',
    'goals','investments','notifications','recurring_transactions','settings',
    'transactions'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end
$do$;

-- profiles: readable; writable only on the columns migration 03 named.
-- Table-level UPDATE must stay revoked or subscription_plan becomes
-- user-writable again -- the exact bypass 02 closed.
grant select on public.profiles to authenticated;
revoke update on public.profiles from authenticated;
grant update (first_name, last_name, username, phone, lastlogin, updated_at)
  on public.profiles to authenticated;
revoke all on public.profiles from anon;

-- subscriptions: readable only. No user write path, by design.
grant select on public.subscriptions to authenticated;
revoke insert, update, delete on public.subscriptions from authenticated;
revoke all on public.subscriptions from anon;