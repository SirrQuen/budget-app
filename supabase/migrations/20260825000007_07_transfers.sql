-- =====================================================================
-- 07: Transfers
--
-- A transfer is two transaction rows sharing a transfer_group_id: an
-- Expense leg on the source account and an Income leg on the destination.
-- Both amounts positive; direction carried by transaction_type as usual.
--
-- v_account_balances needs no change -- each account already sees its own
-- leg. Every income/expense/spending aggregate must EXCLUDE rows where
-- transfer_group_id is not null, or a transfer inflates both sides.
--
-- categoryid becomes nullable: a transfer has no category. Deliberately
-- NOT modelled as reserved "Transfer In/Out" categories -- those would
-- appear in the user's category manager where they could be renamed,
-- archived or deleted, silently breaking transfers.
-- =====================================================================

alter table transactions
  add column if not exists transfer_group_id uuid;

create index if not exists transactions_transfer_group_idx
  on transactions (transfer_group_id)
  where transfer_group_id is not null;

-- DROP NOT NULL is already a no-op if the column is already nullable, but
-- guarded explicitly here to match the idempotent style of the rest of
-- this file.
do $do$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions'
      and column_name = 'categoryid' and is_nullable = 'NO'
  ) then
    alter table transactions alter column categoryid drop not null;
  end if;
end
$do$;

-- A transfer has no category; a normal transaction must have one.
alter table transactions
  drop constraint if exists transactions_category_required;
alter table transactions
  add constraint transactions_category_required
  check (transfer_group_id is not null or categoryid is not null);


-- =====================================================================
-- STEP 1 -- enforce_category_type(): explicit null-categoryid guard
--
-- A transfer leg has no category. The lookup already no-oped for a
-- null categoryid -- `id = null` matches no rows, so v_type came back
-- null and the mismatch check never fired -- but that was incidental,
-- not a guarantee anyone meant to rely on. Made explicit, and skips
-- the pointless lookup for every transfer leg.
-- =====================================================================

create or replace function public.enforce_category_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_type text;
begin
  if new.categoryid is null then
    return new;
  end if;

  select category_type into v_type
    from public.categories where id = new.categoryid;

  if v_type is not null and v_type <> new.transaction_type then
    raise exception
      'Category is % but transaction is % (category %)',
      v_type, new.transaction_type, new.categoryid
      using errcode = '23514';
  end if;

  return new;
end;
$fn$;


-- =====================================================================
-- STEP 2 -- Rebuild views, excluding transfer legs
--
-- Every one of these aggregates income/expense from `transactions`.
-- The only change in each is `transfer_group_id is null` added to its
-- transaction filter -- column lists, joins, and everything else are
-- untouched. Each create is preceded by its own `drop view if exists`
-- so a partial failure partway through this block is retryable.
--
-- v_account_balances and v_net_worth are deliberately NOT touched: a
-- transfer must still move money between the two accounts' balances.
-- =====================================================================

drop view if exists public.v_category_spending;
create view public.v_category_spending
with (security_invoker = true) as
select
  t.userid,
  date_trunc('month', t.transaction_date)::date as month,
  cg.id as group_id, cg.name as group_name, cg.sort_order as group_sort_order,
  c.id as category_id, c.category_name,
  c.icon as category_icon, c.color as category_color,
  sum(t.amount)           as total_spend,
  count(*)                as transaction_count,
  round(avg(t.amount), 2) as avg_transaction,
  max(t.amount)           as largest_transaction,
  round(100 * sum(t.amount) / nullif(
    sum(sum(t.amount)) over (
      partition by t.userid, date_trunc('month', t.transaction_date)), 0), 1) as pct_of_month
from transactions t
join categories c       on c.id  = t.categoryid
join category_groups cg on cg.id = c.groupid
where t.transaction_type = 'Expense'
  and t.transfer_group_id is null
group by t.userid, date_trunc('month', t.transaction_date),
         cg.id, cg.name, cg.sort_order, c.id, c.category_name, c.icon, c.color;

drop view if exists public.v_monthly_cashflow;
create view public.v_monthly_cashflow
with (security_invoker = true) as
select
  t.userid,
  date_trunc('month', t.transaction_date)::date                            as month,
  coalesce(sum(t.amount) filter (where t.transaction_type='Income'), 0)    as income,
  coalesce(sum(t.amount) filter (where t.transaction_type='Expense'), 0)   as expenses,
  coalesce(sum(t.amount) filter (where t.transaction_type='Income'), 0)
    - coalesce(sum(t.amount) filter (where t.transaction_type='Expense'),0) as net_cashflow,
  case when coalesce(sum(t.amount) filter (where t.transaction_type='Income'),0) > 0
       then round((coalesce(sum(t.amount) filter (where t.transaction_type='Income'),0)
                 - coalesce(sum(t.amount) filter (where t.transaction_type='Expense'),0))
                 / sum(t.amount) filter (where t.transaction_type='Income') * 100, 1) end
                                                                           as savings_rate_pct,
  count(*) filter (where t.transaction_type='Income')                      as income_count,
  count(*) filter (where t.transaction_type='Expense')                     as expense_count
from transactions t
where t.transfer_group_id is null
group by t.userid, date_trunc('month', t.transaction_date)::date;

drop view if exists public.v_daily_cashflow;
create view public.v_daily_cashflow
with (security_invoker = true) as
select
  t.userid,
  t.transaction_date                                                     as day,
  coalesce(sum(t.amount) filter (where t.transaction_type='Income'), 0)  as income,
  coalesce(sum(t.amount) filter (where t.transaction_type='Expense'), 0) as expenses,
  coalesce(sum(t.amount) filter (where t.transaction_type='Income'), 0)
    - coalesce(sum(t.amount) filter (where t.transaction_type='Expense'),0) as net_cashflow,
  count(*)                                                               as transaction_count,
  sum(coalesce(sum(t.amount) filter (where t.transaction_type='Income'),0)
    - coalesce(sum(t.amount) filter (where t.transaction_type='Expense'),0))
    over (partition by t.userid order by t.transaction_date
          rows between unbounded preceding and current row)              as running_net
from transactions t
where t.transfer_group_id is null
group by t.userid, t.transaction_date;

drop view if exists public.v_budget_vs_actual;
create view public.v_budget_vs_actual
with (security_invoker = true) as
select
  b.id as budget_id, b.userid, b.budget_month,
  c.id as category_id, c.category_name,
  c.icon as category_icon, c.color as category_color,
  cg.id as group_id, cg.name as group_name,
  b.budget_amount,
  coalesce(s.actual_spend, 0)                   as actual_spend,
  b.budget_amount - coalesce(s.actual_spend, 0) as remaining,
  case when b.budget_amount > 0
       then round(coalesce(s.actual_spend,0) / b.budget_amount * 100, 1) end as pct_used,
  coalesce(s.actual_spend, 0) > b.budget_amount as is_over_budget,
  coalesce(s.transaction_count, 0)              as transaction_count,
  case
    when b.budget_amount = 0 and coalesce(s.actual_spend,0) = 0 then 'Unbudgeted'
    when b.budget_amount = 0 then 'Over'
    when r.ratio >= 1.0      then 'Over'
    when r.ratio >= 0.8      then 'Near Limit'
    else 'On Track'
  end                                           as status,
  case
    when b.budget_amount = 0 and coalesce(s.actual_spend,0) = 0 then 0
    when b.budget_amount = 0 then 3
    when r.ratio >= 1.0      then 3
    when r.ratio >= 0.8      then 2
    else 1
  end                                           as status_rank
from budgets b
join categories c       on c.id  = b.categoryid
join category_groups cg on cg.id = c.groupid
left join lateral (
  select sum(t.amount) as actual_spend, count(*) as transaction_count
  from transactions t
  where t.categoryid = b.categoryid
    and t.transaction_type = 'Expense'
    and t.transaction_date >= b.budget_month
    and t.transaction_date <  (b.budget_month + interval '1 month')
    and t.transfer_group_id is null
) s on true
left join lateral (
  select case when b.budget_amount > 0
              then coalesce(s.actual_spend,0) / b.budget_amount end as ratio
) r on true;

drop view if exists public.v_dashboard_kpis;
create view public.v_dashboard_kpis
with (security_invoker = true) as
select
  p.id                                    as userid,
  date_trunc('month', current_date)::date as period_month,
  coalesce(bal.cash_balance, 0)           as cash_balance,
  coalesce(bal.investment_balance, 0)     as investment_balance,
  coalesce(nw.total_assets, 0)            as total_assets,
  coalesce(nw.total_liabilities, 0)       as total_liabilities,
  coalesce(nw.net_worth, 0)               as net_worth,
  coalesce(cf.income, 0)                  as total_earned,
  coalesce(cf.expenses, 0)                as total_spent,
  coalesce(cf.income,0) - coalesce(cf.expenses,0) as net_cashflow,
  case when coalesce(cf.income,0) > 0
       then round((cf.income - cf.expenses) / cf.income * 100, 1) end as savings_rate_pct,
  coalesce(cf.transaction_count, 0)       as transaction_count
from profiles p
left join lateral (
  select n.total_assets, n.total_liabilities, n.net_worth
  from public.v_net_worth n where n.userid = p.id
) nw on true
left join lateral (
  select sum(b.balance) filter (where b.account_type in ('Checking','Savings','Cash')) as cash_balance,
         sum(b.balance) filter (where b.account_type = 'Investment')                   as investment_balance
  from public.v_account_balances b where b.userid = p.id and b.is_active
) bal on true
left join lateral (
  select sum(t.amount) filter (where t.transaction_type='Income')  as income,
         sum(t.amount) filter (where t.transaction_type='Expense') as expenses,
         count(*)                                                  as transaction_count
  from transactions t
  where t.userid = p.id
    and t.transaction_date >= date_trunc('month', current_date)::date
    and t.transaction_date <  (date_trunc('month', current_date) + interval '1 month')::date
    and t.transfer_group_id is null
) cf on true;


-- =====================================================================
-- STEP 3 -- v_integrity_issues: flag unbalanced transfer groups
--
-- A healthy transfer_group_id has exactly two legs, equal amounts, and
-- opposite transaction_types. Since Income/Expense are the only two
-- values, "opposite" just means the two legs' types aren't equal.
-- Anything else -- a missing leg, a duplicate, an amount edited on
-- only one side -- gets flagged.
-- =====================================================================

drop view if exists public.v_integrity_issues;
create view public.v_integrity_issues
with (security_invoker = true) as
select 'contribution_amount_mismatch'::text as issue_type,
       'medium'::text                       as severity,
       'goal_contributions'::text           as table_name,
       gc.id                                as record_id,
       t.userid,
       format('contribution %s vs transaction %s', gc.amount, t.amount) as detail
from goal_contributions gc
join transactions t on t.id = gc.transactionid
where gc.amount is distinct from t.amount

union all

select 'missing_price', 'low', 'investments', i.investment_id, i.userid,
       format('%s (%s): %s shares held, no current_price', i.ticker, i.asset_type, i.shares)
from public.v_investment_holdings i
where i.price_is_stale and i.is_open

union all

select 'recurring_overdue', 'medium', 'recurring_transactions', r.recurring_id, r.userid,
       format('%s was due %s (%s days ago)', r.description, r.next_run_date, abs(r.days_until))
from public.v_upcoming_recurring r
where r.is_overdue

union all

select 'transfer_leg_mismatch', 'high', 'transactions', tg.transfer_group_id, tg.userid,
       format('transfer_group %s: %s leg(s), %s distinct amount(s), %s distinct type(s)',
              tg.transfer_group_id, tg.leg_count, tg.distinct_amounts, tg.distinct_types)
from (
  select transfer_group_id,
         userid,
         count(*)                         as leg_count,
         count(distinct amount)           as distinct_amounts,
         count(distinct transaction_type) as distinct_types
  from transactions
  where transfer_group_id is not null
  group by transfer_group_id, userid
) tg
where tg.leg_count <> 2
   or tg.distinct_amounts <> 1
   or tg.distinct_types <> 2;


-- =====================================================================
-- STEP 4 -- Grants
--
-- DROP VIEW does not preserve grants across the rebuild in step 2/3 --
-- restate them for every view touched in this file. Idempotent as-is.
-- =====================================================================

do $do$
declare v text;
begin
  foreach v in array array[
    'v_category_spending','v_monthly_cashflow','v_daily_cashflow',
    'v_dashboard_kpis','v_budget_vs_actual','v_integrity_issues'
  ] loop
    execute format('revoke all on public.%I from anon', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end
$do$;