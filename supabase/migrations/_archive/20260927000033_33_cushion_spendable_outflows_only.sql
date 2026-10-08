-- =====================================================================
-- EverNest 33: the suggested cushion averages only money that leaves
-- Checking/Savings
--
-- 32_safe_to_spend_projection.sql averaged every non-recurring Expense,
-- card spending included. That double-counts: a grocery run on a credit
-- card doesn't leave Checking, it arrives later inside the card payment,
-- which the projection already subtracts as an obligation. Charging it in
-- the cushion too charges the user twice for the same money.
--
-- Now the average uses the same "leaves the set" rule as the projection's
-- obligations (lib/safeToSpend.ts's isSafeToSpendCommitment), applied to
-- non-recurring transactions:
--
--   Expense from Checking/Savings                    -> counts
--   Transfer out of Checking/Savings to anything
--     else (e.g. a one-off card payment, an
--     Investment top-up)                             -> counts
--   Transfer between two Checking/Savings accounts   -> doesn't
--   anything drawn from Credit Card, Cash,
--     Investment or Loan                             -> doesn't
--
-- Recurring rows stay excluded (they're obligations in the projection).
-- History length and window are unchanged: trailing 90 days, or all
-- history if shorter, once 60 days exist; $200 before that.
-- =====================================================================

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
            where t.transaction_type = 'Expense'
              and t.recurringid is null
              and a.account_type in ('Checking', 'Savings')
              -- A transfer's Expense leg counts only when its Income leg
              -- lands outside Checking/Savings.
              and not exists (
                select 1
                from transactions leg
                join accounts la on la.id = leg.accountid
                where t.transfer_group_id is not null
                  and leg.transfer_group_id = t.transfer_group_id
                  and leg.transaction_type = 'Income'
                  and la.account_type in ('Checking', 'Savings')
              )
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
  'Default safe-to-spend cushion: seven days of average daily non-recurring spend that leaves Checking/Savings (Expenses from those accounts, and transfers out of the set -- never card spending, which arrives later inside the card payment), trailing 90 days or all history if shorter, rounded to the nearest $25, once there are 60+ days of history; $200 otherwise. settings.safe_to_spend_cushion overrides it when non-null.';

revoke all on function public.suggested_safe_to_spend_cushion() from public, anon;
grant execute on function public.suggested_safe_to_spend_cushion() to authenticated;
