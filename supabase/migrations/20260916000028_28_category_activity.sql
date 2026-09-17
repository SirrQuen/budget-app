-- =====================================================================
-- EverNest 28: v_category_activity
--
-- Backs the new "This month" column on the categories screen -- a
-- lightweight per-category usage snapshot, deliberately NOT folded into
-- v_category_spending (Expense-only, and the dashboard's chart/movement
-- code depends on that shape -- see 01_drop_families.sql and
-- getGroupMovement in lib/db/dashboard.ts). This view covers Income
-- categories too.
--
-- Every transaction under a category shares that category's
-- category_type (enforced by a trigger -- see CLAUDE.md "A trigger
-- requires transaction_type to match the category's category_type"), and
-- transactions.amount is always positive, so a plain sum(amount) IS the
-- total in the category's own direction -- no signed_amount/CASE needed.
--
-- lifetime_transaction_count and last_transaction_date are un-windowed
-- (all time, no is_active filter) so the categories screen can tell "used
-- before, nothing this month" ($0.00) apart from "never used"
-- ("Not used yet") -- the distinction that actually matters for deciding
-- what to archive.
-- =====================================================================

create view public.v_category_activity
with (security_invoker = true) as
select
  c.userid,
  c.id                             as category_id,
  coalesce(cur.month_total, 0)     as current_month_total,
  coalesce(life.transaction_count, 0) as lifetime_transaction_count,
  life.last_transaction_date
from categories c
left join lateral (
  select sum(t.amount) as month_total
  from transactions t
  where t.categoryid = c.id
    and t.transaction_date >= date_trunc('month', current_date)::date
    and t.transaction_date < (date_trunc('month', current_date) + interval '1 month')::date
) cur on true
left join lateral (
  select count(*) as transaction_count, max(t.transaction_date) as last_transaction_date
  from transactions t
  where t.categoryid = c.id
) life on true;

-- Explicit, not looped in with 04_hardening.sql's STEP 10 grant block --
-- that array is hardcoded and doesn't pick up views added later, which is
-- exactly how a view can go live ungranted. Every migration since
-- (18/19/21/23/24/25/26/27) grants its own new view directly; this one
-- does the same.
grant select on public.v_category_activity to authenticated;
revoke all on public.v_category_activity from anon;
