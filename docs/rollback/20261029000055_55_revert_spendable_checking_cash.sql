-- =====================================================================
-- EverNest 55: REVERT 54 -- the spendable set back to Checking + Savings
--
-- Insurance for migration 54, kept OUT of supabase/migrations/ until it's
-- needed: in that directory, the same `db push` that applies 54 would
-- apply this straight after it. To use it, move this file into
-- supabase/migrations/ (rename the timestamp if a later migration
-- exists) and push.
--
-- This only reverts the SQL. The TypeScript twin, SPENDABLE_ACCOUNT_TYPES
-- (lib/safeToSpend.ts), must go back in the same deploy -- revert merge
-- 1d3e135 -- or production runs a mixed set and the hero is meaningless.
-- `npm run test:parity` fails until both sides agree.
--
-- Restores exactly what 54 replaced: is_spendable_account_type()'s body
-- (migration 47) and the four function comments (migrations 45 and 47),
-- copied verbatim.
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


comment on function public.leaves_spendable_set(text, text) is
  'The SQL side of the "leaves the set" classifier: true when money moving out of an account of type p_from_type leaves Checking/Savings. p_to_type is the transfer destination''s account type, null for an Expense. Must agree with isSafeToSpendCommitment (lib/safeToSpend.ts) for every account-type pair; docs/leaves-spendable-set-parity.sql (npm run test:parity) checks this against the types in accounts_account_type_check. Never re-derive this rule inline.';


comment on function public.spendable_cash_balance() is
  'Spendable Cash: the summed balance of the caller''s active accounts whose type is_spendable_account_type() accepts (Checking, Savings). Read by getSafeToSpend (lib/db/dashboard.ts). security invoker: RLS on v_account_balances scopes it to auth.uid().';


comment on function public.suggested_safe_to_spend_cushion() is
  'Default safe-to-spend cushion: seven days of average daily non-recurring spend that leaves Checking/Savings, trailing 90 days or all history if shorter, rounded to the nearest $25, once there are 60+ days of history; $200 otherwise. settings.safe_to_spend_cushion overrides it when non-null. "Leaves Checking/Savings" is leaves_spendable_set(), applied to each Expense row with its transfer''s Income-leg account as the destination. Card spending never counts: it arrives later inside the card payment. docs/leaves-spendable-set-parity.sql (npm run test:parity) checks that this function counts exactly the rows isSafeToSpendCommitment (lib/safeToSpend.ts) would.';
