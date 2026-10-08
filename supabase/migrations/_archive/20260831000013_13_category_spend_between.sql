-- =====================================================================
-- 13: category_spend_between(p_from, p_to) -- ranged category spend for
-- the dashboard's date-range filter.
--
-- v_category_spending buckets by date_trunc('month', ...), so it can't
-- answer "spend per category between two arbitrary days" -- the filter's
-- presets (last 7 / 30 / 90 days, month-to-date) and custom ranges all
-- land mid-month. The dashboard's category-movement panel needs a
-- per-category total over an exact [p_from, p_to] span, and its
-- comparison window is a second call with the preceding span.
--
-- Same shape and filters as v_category_spending's Expense side: positive
-- amounts only, transfer legs excluded, inactive categories excluded.
-- Aggregation stays in SQL (never summed in JS).
--
-- security invoker: runs as the calling user, so the transactions /
-- categories RLS policies (userid = auth.uid()) scope the rows. No
-- explicit userid filter -- that would only create the illusion RLS is
-- optional. STABLE: reads tables, no writes, same result within a stmt.
-- =====================================================================

create or replace function public.category_spend_between(p_from date, p_to date)
returns table (
  group_id uuid,
  group_name text,
  group_sort_order integer,
  category_id uuid,
  category_name text,
  total_spend numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    cg.id,
    cg.name,
    cg.sort_order,
    c.id,
    c.category_name,
    coalesce(sum(t.amount), 0)
  from transactions t
  join categories c on c.id = t.categoryid
  join category_groups cg on cg.id = c.groupid
  where t.transaction_type = 'Expense'
    and t.transfer_group_id is null
    and c.is_active
    and t.transaction_date between p_from and p_to
  group by cg.id, cg.name, cg.sort_order, c.id, c.category_name;
$$;

comment on function public.category_spend_between(date, date) is
  'Per-category Expense total between two dates, inclusive. Mirrors v_category_spending''s filters (positive amounts, no transfer legs, active categories only) for spans that do not align to month boundaries. Call twice -- selected window and preceding window -- for the dashboard category-movement comparison.';

revoke all on function public.category_spend_between(date, date) from public, anon;
grant execute on function public.category_spend_between(date, date) to authenticated;
