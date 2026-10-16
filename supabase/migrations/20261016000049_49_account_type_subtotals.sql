-- =====================================================================
-- EverNest 49: account_type_subtotals -- the Accounts page's per-type
-- subtotals, summed in SQL
--
-- app/(app)/accounts/page.tsx added up each type group's balances in
-- JavaScript floats. CLAUDE.md: never aggregate money in JavaScript.
-- This returns the same figures from v_account_balances.
--
-- p_include_archived mirrors the page's "Show archived" toggle: the
-- subtotal covers exactly the rows the page lists.
-- =====================================================================

create or replace function public.account_type_subtotals(p_include_archived boolean)
returns table (account_type text, subtotal numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select b.account_type, coalesce(sum(b.balance), 0)
    from v_account_balances b
   where p_include_archived or b.is_active
   group by b.account_type;
$$;

comment on function public.account_type_subtotals(boolean) is
  'Accounts page subtotals: summed balance per account_type over active accounts, or all accounts when p_include_archived. security invoker: RLS on v_account_balances scopes it to auth.uid().';

revoke all on function public.account_type_subtotals(boolean) from public, anon;
grant execute on function public.account_type_subtotals(boolean) to authenticated;
