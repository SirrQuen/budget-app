-- =====================================================================
-- EverNest 54: the spendable set becomes Checking + Cash
--
-- Safe to spend counts money you can spend today: Checking and Cash.
-- Savings leaves the set -- it's still yours (net worth, the accounts
-- page and its per-type subtotals all keep it), just not everyday
-- spending. Cash comes back in: with it excluded, a Checking -> Cash
-- withdrawal counted as spending, so $100 from an ATM lowered safe to
-- spend by $100 nobody had spent. docs/phase-7-findings.md, "Spendable
-- set: Checking + Cash".
--
-- The set has one SQL list, is_spendable_account_type() (migration 47),
-- and one TS list, SPENDABLE_ACCOUNT_TYPES (lib/safeToSpend.ts). Both
-- change together; nothing else lists it. What follows from the new set,
-- with no other edit:
--   spendable_cash_balance()  sums active Checking + Cash
--   leaves_spendable_set()    Checking/Cash -> Savings now leaves;
--                             Checking <-> Cash doesn't
--   the cushion suggestion    counts spending that leaves Checking/Cash
-- docs/leaves-spendable-set-parity.sql (npm run test:parity) checks the
-- SQL and TS sets still agree for every type in
-- accounts_account_type_check.
--
-- The rest of this migration replaces function comments that named the
-- old set.
-- =====================================================================

create or replace function public.is_spendable_account_type(p_type text)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(p_type in ('Checking', 'Cash'), false);
$$;

comment on function public.is_spendable_account_type(text) is
  'The SQL side of SPENDABLE_ACCOUNT_TYPES / isSpendableAccountType (lib/safeToSpend.ts): true for the account types whose balance is spendable cash (Checking, Cash). The only SQL list of the spendable set; leaves_spendable_set() and spendable_cash_balance() call it. docs/leaves-spendable-set-parity.sql (npm run test:parity) checks it against the TS set for every type in accounts_account_type_check. Never re-list the set inline.';

comment on function public.leaves_spendable_set(text, text) is
  'The SQL side of the "leaves the set" classifier: true when money moving out of an account of type p_from_type leaves the spendable set (is_spendable_account_type). p_to_type is the transfer destination''s account type, null for an Expense. Must agree with isSafeToSpendCommitment (lib/safeToSpend.ts) for every account-type pair; docs/leaves-spendable-set-parity.sql (npm run test:parity) checks this against the types in accounts_account_type_check. Never re-derive this rule inline.';

comment on function public.spendable_cash_balance() is
  'Spendable Cash: the summed balance of the caller''s active accounts whose type is_spendable_account_type() accepts (Checking, Cash). Read by getSafeToSpend (lib/db/dashboard.ts). security invoker: RLS on v_account_balances scopes it to auth.uid().';

comment on function public.suggested_safe_to_spend_cushion() is
  'Default safe-to-spend cushion: seven days of average daily non-recurring spend that leaves the spendable set (Checking, Cash), trailing 90 days or all history if shorter, rounded to the nearest $25, once there are 60+ days of history; $200 otherwise. settings.safe_to_spend_cushion overrides it when non-null. "Leaves the set" is leaves_spendable_set(), applied to each Expense row with its transfer''s Income-leg account as the destination. Card spending never counts: it arrives later inside the card payment. docs/leaves-spendable-set-parity.sql (npm run test:parity) checks that this function counts exactly the rows isSafeToSpendCommitment (lib/safeToSpend.ts) would.';
