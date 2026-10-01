-- =====================================================================
-- EverNest 35: Card payments are priced per statement cycle
--
-- The safe-to-spend projection (lib/safeToSpendProjection.ts) used to
-- price every occurrence of a variable card payment at the NEXT payment's
-- figure -- so a horizon holding two payments paid today's balance twice.
-- It now prices the first payment as before and each later one from the
-- card's own charges in that statement cycle.
--
-- For a CONFIRMED next payment, v_upcoming_recurring.amount is the
-- statement amount, and whatever the card owes beyond it posted after the
-- statement closed -- that belongs to the following payment. The
-- projection needs the balance to know it, so:
--
--   v_upcoming_recurring.card_balance_owed   greatest(-balance, 0) of the
--     destination card, for a variable card payment only; null otherwise.
--     The same figure `amount` already uses when unconfirmed.
-- =====================================================================

-- v_upcoming_recurring: unchanged from 32_safe_to_spend_projection.sql
-- except for card_balance_owed appended at the end.
create or replace view public.v_upcoming_recurring
with (security_invoker = true) as
select
  r.id as recurring_id, r.userid, r.description,
  case
    when not r.amount_is_variable then r.amount
    when r.to_accountid is not null and r.next_amount_confirmed_at is not null then r.next_amount
    when r.to_accountid is not null then greatest(-cb.balance, 0)
    when c.category_type = 'Expense' then public.estimate_expense_amount(r.id, r.amount)
    else public.estimate_income_amount(r.id, r.amount)
  end as amount,
  r.frequency,
  r.next_run_date, r.start_date, r.end_date,
  r.accountid, a.account_name, a.color as account_color,
  r.categoryid, c.category_name, c.icon as category_icon, c.color as category_color,
  (r.next_due_date - current_date) as days_until,
  (r.next_due_date < current_date) as is_overdue,
  r.interval_count, r.occurrence_limit,
  r.to_accountid, ta.account_name as to_account_name,
  c.category_type,
  r.amount_is_variable, r.statement_day, r.next_amount, r.next_amount_confirmed_at,
  (r.amount_is_variable and (r.to_accountid is null or r.next_amount_confirmed_at is null)) as is_estimated_amount,
  r.next_due_date, a.account_type,
  ta.account_type as to_account_type,
  r.date_tolerance_days, r.requires_confirmation,
  case
    when r.amount_is_variable and r.to_accountid is null and c.category_type = 'Income'
      then public.estimate_income_amount_low(r.id, r.amount)
  end as amount_low,
  r.business_day_offset, r.non_business_day_rule,
  case
    when r.occurrence_limit is not null
      then r.occurrence_limit - (select count(*) from transactions t where t.recurringid = r.id)
  end as occurrences_remaining,
  case
    when r.amount_is_variable and r.to_accountid is not null
      then greatest(-cb.balance, 0)
  end as card_balance_owed
from recurring_transactions r
join accounts a        on a.id  = r.accountid
left join categories c on c.id  = r.categoryid
left join accounts ta  on ta.id = r.to_accountid
left join public.v_account_balances cb on cb.account_id = r.to_accountid
where r.is_active
  and (r.end_date is null or r.end_date >= current_date)
  and (r.occurrence_limit is null
       or (select count(*) from transactions t where t.recurringid = r.id) < r.occurrence_limit);

grant select on public.v_upcoming_recurring to authenticated;
revoke all on public.v_upcoming_recurring from anon;
