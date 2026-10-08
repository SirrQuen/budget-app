-- =====================================================================
-- 06: Enforce the liability sign convention
--
-- v_net_worth computes total_liabilities as -sum(balance) over Credit
-- Card and Loan, and net_worth as an unfiltered sum(balance). Both are
-- correct ONLY if liability balances are negative. Nothing enforced it,
-- so liability accounts were created with positive opening balances,
-- inverting both figures.
-- =====================================================================

update accounts
set opening_balance = -opening_balance
where account_type in ('Credit Card', 'Loan')
  and opening_balance > 0;

alter table accounts
  add constraint accounts_liability_sign
  check (
    account_type not in ('Credit Card', 'Loan')
    or opening_balance <= 0
  );