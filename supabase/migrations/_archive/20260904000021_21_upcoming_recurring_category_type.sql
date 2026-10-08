-- =====================================================================
-- EverNest 21: v_upcoming_recurring carries category_type
--
-- getSafeToSpend() has read recurring_transactions directly instead of
-- this view since it was first written, because the view dropped the one
-- column that carries a category schedule's Income/Expense direction.
-- That's no longer true anywhere else the view is missing something --
-- appending category_type (a plain LEFT JOIN column, null for a transfer
-- template exactly like category_name/category_icon already are) lets
-- getSafeToSpend read the view like everything else does, which is worth
-- doing: the view already carries the occurrence_limit-exhaustion guard
-- (19_recurring_transfers) that the direct base-table query never had --
-- an exhausted schedule's frozen next_run_date could fall inside the
-- window and get counted as a commitment that will never actually post.
--
-- CREATE OR REPLACE, not drop+create -- v_integrity_issues selects named
-- columns from this view (07_transfers.sql); category_type is appended
-- strictly after to_account_name, the last column 19_recurring_transfers
-- added, for the same reason those were appended rather than inserted.
create or replace view public.v_upcoming_recurring
with (security_invoker = true) as
select
  r.id as recurring_id, r.userid, r.description, r.amount, r.frequency,
  r.next_run_date, r.start_date, r.end_date,
  r.accountid, a.account_name, a.color as account_color,
  r.categoryid, c.category_name, c.icon as category_icon, c.color as category_color,
  (r.next_run_date - current_date) as days_until,
  (r.next_run_date < current_date) as is_overdue,
  r.interval_count, r.occurrence_limit,
  r.to_accountid, ta.account_name as to_account_name,
  c.category_type
from recurring_transactions r
join accounts a        on a.id  = r.accountid
left join categories c on c.id  = r.categoryid
left join accounts ta  on ta.id = r.to_accountid
where r.is_active
  and (r.end_date is null or r.end_date >= current_date)
  and (r.occurrence_limit is null
       or (select count(*) from transactions t where t.recurringid = r.id) < r.occurrence_limit);

grant select on public.v_upcoming_recurring to authenticated;
revoke all on public.v_upcoming_recurring from anon;
