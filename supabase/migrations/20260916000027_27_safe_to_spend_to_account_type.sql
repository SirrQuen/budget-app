-- =====================================================================
-- EverNest 27: v_upcoming_recurring.to_account_type
--
-- getSafeToSpend's commitment rule (lib/safeToSpend.ts) needs a transfer's
-- DESTINATION account type, not just its source (already exposed as
-- account_type) -- a transfer between two spendable accounts (Checking ->
-- Savings) must not count as a commitment, since the money never actually
-- leaves the Checking/Savings set. New column appended strictly after
-- to_account_type's neighbours and after the last column
-- 25_bank_holidays.sql added -- CREATE OR REPLACE can't reorder an
-- existing view's columns.
-- =====================================================================

create or replace view public.v_upcoming_recurring
with (security_invoker = true) as
select
  r.id as recurring_id, r.userid, r.description,
  case
    when not r.amount_is_variable then r.amount
    when r.next_amount_confirmed_at is not null then r.next_amount
    else greatest(-cb.balance, 0)
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
  (r.amount_is_variable and r.next_amount_confirmed_at is null) as is_estimated_amount,
  r.next_due_date, a.account_type,
  ta.account_type as to_account_type
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
