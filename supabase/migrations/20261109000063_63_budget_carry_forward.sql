-- =====================================================================
-- Sorrel 63: one budget per category per month, and budgets carry
-- forward by derivation (docs/Budgets-Reminders-and-Pending.md, items 2-3)
--
-- 1. Uniqueness. Nothing stopped two rows for one (userid, budget_month,
--    categoryid): "Add budget" offered every category, including ones
--    already budgeted that month, and an edit could move a row's category
--    or month onto another row's. Checked on production 2026-11-09
--    (ybdwqyihvbokowocvlgq, read-only): 26 rows, 0 duplicate groups, so
--    this applies cleanly. The write paths are fixed in the app
--    (lib/actions/budgets.ts); this is the backstop, not the fix.
--
-- 2. A budget amount is STANDING, not monthly. Set Groceries at $600 and
--    it stays $600 until changed. So carry-forward is PER CATEGORY: for a
--    month, each category shows its own row if it has one, else its most
--    recent row from an earlier month -- not strictly last month, so a
--    skipped month resets nobody. Each category is evaluated on its own,
--    so editing one writes one row and the rest keep carrying.
--
--    budget_progress_for_month() DERIVES that; it writes nothing. No
--    scheduled job, no rollover event, nothing created by opening a page
--    (CLAUDE.md "A page render never writes"). A row is written only when
--    the person edits, for that category and month.
--
--    $0 carries as $0 -- a deliberate "not spending on this" is a budget.
--    An archived category (is_active = false) doesn't carry; its own rows
--    in their own months still show, as before.
--
-- 3. The spent-vs-budgeted figures are shared between v_budget_vs_actual
--    (explicit rows, every month -- history) and the new function (one
--    month, carried rows included) through three helpers, so the two can't
--    drift. v_budget_vs_actual's output is unchanged.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. One budget per category per month
-- ---------------------------------------------------------------------
alter table public.budgets
  add constraint budgets_one_per_category_month unique (userid, budget_month, categoryid);

comment on constraint budgets_one_per_category_month on public.budgets is
  'One budget per category per month. The backstop for the app''s write paths, which upsert on this key (migration 63).';


-- ---------------------------------------------------------------------
-- 2. The figures, once
-- ---------------------------------------------------------------------
create function public.budget_pct_used(p_budget numeric, p_spend numeric)
returns numeric
language sql
immutable
parallel safe
as $$
  select case when p_budget > 0 then round((p_spend / p_budget) * 100, 1) end;
$$;

create function public.budget_status(p_budget numeric, p_spend numeric)
returns text
language sql
immutable
parallel safe
as $$
  select case
           when p_budget = 0 and p_spend = 0 then 'Unbudgeted'
           when p_budget = 0 then 'Over'
           when p_spend / p_budget >= 1.0 then 'Over'
           when p_spend / p_budget >= 0.8 then 'Near Limit'
           else 'On Track'
         end;
$$;

create function public.budget_status_rank(p_budget numeric, p_spend numeric)
returns integer
language sql
immutable
parallel safe
as $$
  select case
           when p_budget = 0 and p_spend = 0 then 0
           when p_budget = 0 then 3
           when p_spend / p_budget >= 1.0 then 3
           when p_spend / p_budget >= 0.8 then 2
           else 1
         end;
$$;

comment on function public.budget_status(numeric, numeric) is
  'A budget''s status from its amount and the month''s spend. Shared by v_budget_vs_actual and budget_progress_for_month() (migration 63).';
comment on function public.budget_status_rank(numeric, numeric) is
  'Sort rank for budget_status(): 3 over, 2 near, 1 on track, 0 nothing budgeted or spent (migration 63).';
comment on function public.budget_pct_used(numeric, numeric) is
  'Percent of a budget spent, 1 dp; null for a $0 budget (migration 63).';

revoke all on function public.budget_pct_used(numeric, numeric) from public, anon;
revoke all on function public.budget_status(numeric, numeric) from public, anon;
revoke all on function public.budget_status_rank(numeric, numeric) from public, anon;
grant execute on function public.budget_pct_used(numeric, numeric) to authenticated;
grant execute on function public.budget_status(numeric, numeric) to authenticated;
grant execute on function public.budget_status_rank(numeric, numeric) to authenticated;


-- ---------------------------------------------------------------------
-- 3. v_budget_vs_actual: same columns, same values, through the helpers
-- ---------------------------------------------------------------------
create or replace view public.v_budget_vs_actual
with (security_invoker = true) as
select
  b.id as budget_id,
  b.userid,
  b.budget_month,
  c.id as category_id,
  c.category_name,
  c.icon as category_icon,
  c.color as category_color,
  cg.id as group_id,
  cg.name as group_name,
  b.budget_amount,
  coalesce(s.actual_spend, 0) as actual_spend,
  b.budget_amount - coalesce(s.actual_spend, 0) as remaining,
  public.budget_pct_used(b.budget_amount, coalesce(s.actual_spend, 0)) as pct_used,
  coalesce(s.actual_spend, 0) > b.budget_amount as is_over_budget,
  coalesce(s.transaction_count, 0) as transaction_count,
  public.budget_status(b.budget_amount, coalesce(s.actual_spend, 0)) as status,
  public.budget_status_rank(b.budget_amount, coalesce(s.actual_spend, 0)) as status_rank
from public.budgets b
join public.categories c on c.id = b.categoryid
join public.category_groups cg on cg.id = c.groupid
left join lateral (
  select sum(t.amount) as actual_spend, count(*) as transaction_count
    from public.transactions t
   where t.categoryid = b.categoryid
     and t.transaction_type = 'Expense'
     and t.transaction_date >= b.budget_month
     and t.transaction_date < b.budget_month + interval '1 month'
     and t.transfer_group_id is null
) s on true;


-- ---------------------------------------------------------------------
-- 4. budget_progress_for_month(): one month, carried budgets included
--
-- Every column of v_budget_vs_actual, for p_month, plus carried_from:
-- null when the category has its own row this month (budget_id is that
-- row), else the month the amount was carried from (budget_id is null --
-- there is no row for this month, and none is written here).
-- ---------------------------------------------------------------------
create function public.budget_progress_for_month(p_month date)
returns table (
  budget_id          uuid,
  userid             uuid,
  budget_month       date,
  category_id        uuid,
  category_name      text,
  category_icon      text,
  category_color     text,
  group_id           uuid,
  group_name         text,
  budget_amount      numeric,
  actual_spend       numeric,
  remaining          numeric,
  pct_used           numeric,
  is_over_budget     boolean,
  transaction_count  bigint,
  status             text,
  status_rank        integer,
  carried_from       date
)
language sql
stable
security invoker
set search_path = public
as $$
  with month as (
    select date_trunc('month', p_month)::date as m
  ),
  -- Each category's most recent row on or before the month.
  effective as (
    select distinct on (b.categoryid)
           b.id, b.userid, b.categoryid, b.budget_amount, b.budget_month
      from budgets b, month
     where b.budget_month <= month.m
     order by b.categoryid, b.budget_month desc
  )
  select case when e.budget_month = month.m then e.id end,
         e.userid,
         month.m,
         c.id, c.category_name, c.icon, c.color,
         cg.id, cg.name,
         e.budget_amount,
         coalesce(s.actual_spend, 0),
         e.budget_amount - coalesce(s.actual_spend, 0),
         budget_pct_used(e.budget_amount, coalesce(s.actual_spend, 0)),
         coalesce(s.actual_spend, 0) > e.budget_amount,
         coalesce(s.transaction_count, 0),
         budget_status(e.budget_amount, coalesce(s.actual_spend, 0)),
         budget_status_rank(e.budget_amount, coalesce(s.actual_spend, 0)),
         case when e.budget_month < month.m then e.budget_month end
    from effective e
   cross join month
    join categories c on c.id = e.categoryid
    join category_groups cg on cg.id = c.groupid
    left join lateral (
      select sum(t.amount) as actual_spend, count(*) as transaction_count
        from transactions t
       where t.categoryid = e.categoryid
         and t.transaction_type = 'Expense'
         and t.transaction_date >= month.m
         and t.transaction_date < month.m + interval '1 month'
         and t.transfer_group_id is null
    ) s on true
   -- An archived category doesn't carry; a row it has for this month still shows.
   where e.budget_month = month.m or c.is_active;
$$;

comment on function public.budget_progress_for_month(date) is
  'Spent-vs-budgeted for one month, every category with a budget: its own row for the month, else its most recent earlier row (carried_from = that month; budget_id null). Derived, never written. Archived categories don''t carry. security invoker: RLS scopes it to the caller (migration 63).';

revoke all on function public.budget_progress_for_month(date) from public, anon;
grant execute on function public.budget_progress_for_month(date) to authenticated;
