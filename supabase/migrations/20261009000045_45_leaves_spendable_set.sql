-- =====================================================================
-- EverNest 45: leaves_spendable_set -- the one SQL "leaves the set" rule
--
-- docs/phase-7-findings.md, "'Leaves the set' classifier", fix 2.
--
-- Migration 33 wrote the cushion's own copy of the classifier inline and
-- said it "uses the same rule as isSafeToSpendCommitment". Nothing
-- checked that, so the claim was a hope, not a guarantee. This migration
-- moves the rule into one function, leaves_spendable_set(from, to), and
-- suggested_safe_to_spend_cushion() calls it instead of its own copy.
--
-- That leaves two implementations, one per language: SQL can't call
-- TypeScript, and the projection classifies future occurrences that are
-- not rows. What keeps them equal is the parity test,
-- docs/leaves-spendable-set-parity.sql (run with
-- `npm run test:parity`), which:
--   - reads the account types from accounts_account_type_check, never a
--     hardcoded list, and fails if lib/accountOptions.ts's ACCOUNT_TYPES
--     differs -- a new type gets cases on both sides or the test fails;
--   - compares leaves_spendable_set to isSafeToSpendCommitment for every
--     (from, to) pair and every plain Expense;
--   - builds a real transfer with both legs for every pair and checks the
--     cushion counts the Expense leg exactly once, and only when the TS
--     classifier says the money leaves the set.
--
-- The rule (lib/safeToSpend.ts, isSafeToSpendCommitment):
--   source not Checking/Savings              -> doesn't leave
--   Expense (no destination), spendable src  -> leaves
--   Transfer, spendable src, spendable dest  -> doesn't leave
--   Transfer, spendable src, any other dest  -> leaves
--
-- Cushion behaviour is unchanged: same rows counted, same window, same
-- rounding. Only where the rule lives moves.
-- =====================================================================

-- p_to_type is the destination account's type for a transfer, and null
-- for an Expense (the money goes to a merchant, not an account).
create or replace function public.leaves_spendable_set(p_from_type text, p_to_type text)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(
    p_from_type in ('Checking', 'Savings')
      and (p_to_type is null or p_to_type not in ('Checking', 'Savings')),
    false
  );
$$;

comment on function public.leaves_spendable_set(text, text) is
  'The SQL side of the "leaves the set" classifier: true when money moving out of an account of type p_from_type leaves Checking/Savings. p_to_type is the transfer destination''s account type, null for an Expense. Must agree with isSafeToSpendCommitment (lib/safeToSpend.ts) for every account-type pair; docs/leaves-spendable-set-parity.sql (npm run test:parity) checks this against the types in accounts_account_type_check. Never re-derive this rule inline.';

revoke all on function public.leaves_spendable_set(text, text) from public, anon;
grant execute on function public.leaves_spendable_set(text, text) to authenticated;

create or replace function public.suggested_safe_to_spend_cushion()
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  with history as (
    select current_date - min(transaction_date) as days
    from transactions
  ),
  span as (
    select least(days, 90) as days
    from history
    where days >= 60
  )
  select coalesce(
    (
      select round(
        coalesce(
          (
            select sum(t.amount)
            from transactions t
            join accounts a on a.id = t.accountid
            -- A transfer's destination is the account of its Income leg.
            -- A plain Expense has no group, so no leg: dest stays null.
            left join lateral (
              select la.account_type
              from transactions leg
              join accounts la on la.id = leg.accountid
              where leg.transfer_group_id = t.transfer_group_id
                and leg.transaction_type = 'Income'
              limit 1
            ) dest on true
            where t.transaction_type = 'Expense'
              and t.recurringid is null
              and leaves_spendable_set(a.account_type, dest.account_type)
              and t.transaction_date > current_date - span.days
              and t.transaction_date <= current_date
          ),
          0
        ) / span.days * 7 / 25
      ) * 25
      from span
    ),
    200
  );
$$;

comment on function public.suggested_safe_to_spend_cushion() is
  'Default safe-to-spend cushion: seven days of average daily non-recurring spend that leaves Checking/Savings, trailing 90 days or all history if shorter, rounded to the nearest $25, once there are 60+ days of history; $200 otherwise. settings.safe_to_spend_cushion overrides it when non-null. "Leaves Checking/Savings" is leaves_spendable_set(), applied to each Expense row with its transfer''s Income-leg account as the destination. Card spending never counts: it arrives later inside the card payment. docs/leaves-spendable-set-parity.sql (npm run test:parity) checks that this function counts exactly the rows isSafeToSpendCommitment (lib/safeToSpend.ts) would.';
