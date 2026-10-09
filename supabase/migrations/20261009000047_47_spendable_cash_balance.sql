-- =====================================================================
-- EverNest 47: spendable_cash_balance -- sum Spendable Cash in SQL
--
-- getSafeToSpend (lib/db/dashboard.ts) read one balance row per
-- Checking/Savings account and added them up in JavaScript. The result
-- was exact (integer cents), but CLAUDE.md is "never aggregate money in
-- JavaScript". This moves the sum into SQL.
--
-- The filter needs to know which account types are in the spendable set.
-- Writing ('Checking', 'Savings') again would make a second SQL copy of
-- the set next to leaves_spendable_set's. So the set moves into one
-- function, is_spendable_account_type(), the SQL twin of
-- isSpendableAccountType (lib/safeToSpend.ts). Both
-- leaves_spendable_set() and spendable_cash_balance() call it.
-- docs/leaves-spendable-set-parity.sql (npm run test:parity) checks it
-- against SPENDABLE_ACCOUNT_TYPES for every type in
-- accounts_account_type_check.
--
-- leaves_spendable_set's answers are unchanged; only where the set's
-- list lives moves. The parity test's section 2 covers that.
-- =====================================================================

create or replace function public.is_spendable_account_type(p_type text)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(p_type in ('Checking', 'Savings'), false);
$$;

comment on function public.is_spendable_account_type(text) is
  'The SQL side of SPENDABLE_ACCOUNT_TYPES / isSpendableAccountType (lib/safeToSpend.ts): true for the account types whose balance is spendable cash. The only SQL list of the spendable set; leaves_spendable_set() and spendable_cash_balance() call it. docs/leaves-spendable-set-parity.sql (npm run test:parity) checks it against the TS set for every type in accounts_account_type_check. Never re-list the set inline.';

revoke all on function public.is_spendable_account_type(text) from public, anon;
grant execute on function public.is_spendable_account_type(text) to authenticated;

create or replace function public.leaves_spendable_set(p_from_type text, p_to_type text)
returns boolean
language sql
immutable
parallel safe
as $$
  select is_spendable_account_type(p_from_type)
     and (p_to_type is null or not is_spendable_account_type(p_to_type));
$$;

-- Spendable Cash: the summed balance of the user's active Checking and
-- Savings accounts. security invoker, so v_account_balances' RLS scopes it
-- to the caller.
create or replace function public.spendable_cash_balance()
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(balance), 0)
    from v_account_balances
   where is_active
     and is_spendable_account_type(account_type);
$$;

comment on function public.spendable_cash_balance() is
  'Spendable Cash: the summed balance of the caller''s active accounts whose type is_spendable_account_type() accepts (Checking, Savings). Read by getSafeToSpend (lib/db/dashboard.ts). security invoker: RLS on v_account_balances scopes it to auth.uid().';

revoke all on function public.spendable_cash_balance() from public, anon;
grant execute on function public.spendable_cash_balance() to authenticated;
