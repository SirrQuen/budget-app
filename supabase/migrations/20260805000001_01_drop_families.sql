-- =====================================================================
-- EverNest 01: remove the families / multi-tenant layer
--
-- Drops familyid from 10 tables, drops the families table, and rebuilds
-- all 13 views without it.
--
-- This reverses the composite-FK migration. Those constraints existed to
-- keep familyid consistent across the ownership tree; with the column
-- gone they have nothing to protect. The single-column FKs (accountid,
-- categoryid, userid, ...) are untouched and remain your referential
-- integrity.
--
-- ---------------------------------------------------------------------
-- THIS IS DESTRUCTIVE AND NOT REVERSIBLE BY SCRIPT.
--
-- Dropping a column discards its data. If any family grouping exists in
-- production it is gone, and re-adding households later means a fresh
-- migration plus a manual reconstruction of who belonged to what.
--
-- Take a backup first. In Supabase: Database > Backups, or
--   pg_dump --schema=public --data-only > pre_family_drop.sql
-- ---------------------------------------------------------------------
--
-- RUN ORDER: step 1 (inspect) -> step 2 (backup check) -> 3 -> 4 -> 5 -> 6
-- =====================================================================


-- =====================================================================
-- STEP 1 -- Inspect what CASCADE will remove (read-only)
--
-- Run this and read the output before going further. Everything listed
-- disappears in step 4.
-- =====================================================================

-- Constraints that involve familyid (composite FKs, unique keys, single FKs)
select conrelid::regclass as table_name,
       conname,
       contype,
       pg_get_constraintdef(oid) as definition
  from pg_constraint
 where connamespace = 'public'::regnamespace
   and pg_get_constraintdef(oid) ilike '%familyid%'
 order by 1, 2;

-- Indexes that involve familyid
select tablename, indexname, indexdef
  from pg_indexes
 where schemaname = 'public'
   and indexdef ilike '%familyid%'
 order by 1, 2;

-- How much family data actually exists? If these are all zero/null the
-- drop costs you nothing.
select (select count(*) from families)                          as families_rows,
       (select count(*) from profiles where familyid is not null) as profiles_in_a_family;


-- =====================================================================
-- STEP 2 -- Backup confirmation
--
-- Deliberately left as a manual gate. Take the backup, then continue.
-- =====================================================================

-- (no SQL -- confirm your backup exists before running step 3)


-- =====================================================================
-- STEP 3 -- Drop all views
--
-- Views depend on the familyid columns, so they must go first. Reverse
-- dependency order. Every one is recreated in step 6.
-- =====================================================================

drop view if exists public.v_dashboard_kpis;
drop view if exists public.v_goals_summary;
drop view if exists public.v_daily_cashflow;
drop view if exists public.v_integrity_issues;
drop view if exists public.v_upcoming_recurring;
drop view if exists public.v_portfolio_summary;
drop view if exists public.v_investment_holdings;
drop view if exists public.v_goal_progress;
drop view if exists public.v_category_spending;
drop view if exists public.v_monthly_cashflow;
drop view if exists public.v_budget_vs_actual;
drop view if exists public.v_net_worth;
drop view if exists public.v_account_balances;

-- Index built specifically for family-scoped queries.
drop index if exists idx_tx_family_date;


-- =====================================================================
-- STEP 4 -- Drop the familyid columns
--
-- CASCADE is required, not optional: each column is referenced by
-- composite foreign keys living on OTHER tables, and Postgres refuses a
-- plain DROP COLUMN while those exist. CASCADE removes them, along with
-- the UNIQUE (id, familyid) keys and every supporting index.
--
-- Step 1 showed you exactly what that covers. One transaction, so a
-- failure anywhere rolls the whole thing back.
-- =====================================================================

begin;

alter table transactions            drop column familyid cascade;
alter table goal_contributions      drop column familyid cascade;
alter table budgets                 drop column familyid cascade;
alter table recurring_transactions  drop column familyid cascade;
alter table investments             drop column familyid cascade;
alter table goals                   drop column familyid cascade;
alter table categories              drop column familyid cascade;
alter table category_groups         drop column familyid cascade;
alter table accounts                drop column familyid cascade;
alter table profiles                drop column familyid cascade;

commit;


-- =====================================================================
-- STEP 5 -- Drop the families table
--
-- Its RLS policies (which compared auth.uid() to families.id and could
-- never match) are removed with it.
-- =====================================================================

drop table if exists public.families cascade;


-- =====================================================================
-- STEP 6 -- Rebuild the views
--
-- Identical to before minus familyid. Every view keeps
-- WITH (security_invoker = true): without it a view reads its tables
-- with RLS BYPASSED and serves any user's finances to any caller.
--
-- Dependency order matters -- v_account_balances, v_goal_progress and
-- v_investment_holdings are read by later views.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. v_account_balances
-- ---------------------------------------------------------------------
create view public.v_account_balances
with (security_invoker = true) as
select
  a.id                                              as account_id,
  a.userid,
  a.account_name,
  a.account_type,
  a.institution,
  a.color,
  a.account_icon,
  a.is_active,
  a.opening_balance,
  a.current_balance                                 as stored_balance,
  a.opening_balance + coalesce(t.delta, 0)          as balance,
  coalesce(t.transaction_count, 0)                  as transaction_count,
  t.first_transaction_date,
  t.last_transaction_date
from accounts a
left join lateral (
  select
    sum(public.signed_amount(tr.amount, tr.transaction_type)) as delta,
    count(*)                                                  as transaction_count,
    min(tr.transaction_date)                                  as first_transaction_date,
    max(tr.transaction_date)                                  as last_transaction_date
  from transactions tr
  where tr.accountid = a.id
) t on true;

-- ---------------------------------------------------------------------
-- 2. v_net_worth
-- Liability balances arrive NEGATIVE (card spend is an Expense), so
-- total_liabilities negates them into a positive "amount owed".
-- ---------------------------------------------------------------------
create view public.v_net_worth
with (security_invoker = true) as
select
  b.userid,
  coalesce(sum(b.balance) filter (
    where b.account_type in ('Checking', 'Savings', 'Investment', 'Cash')), 0) as total_assets,
  coalesce(-sum(b.balance) filter (
    where b.account_type in ('Credit Card', 'Loan')), 0)                       as total_liabilities,
  coalesce(sum(b.balance), 0)                                                  as net_worth,
  count(*)                                                                     as account_count
from public.v_account_balances b
where b.is_active
group by b.userid;

-- ---------------------------------------------------------------------
-- 3. v_budget_vs_actual  (includes status / status_rank)
--
-- Spend matches on categoryid + month window only. Previously this was
-- justified by shared family categories; with families gone it simply
-- means a category's spend is its spend. Behaviour is unchanged, since
-- a category now has exactly one owner anyway.
-- ---------------------------------------------------------------------
create view public.v_budget_vs_actual
with (security_invoker = true) as
select
  b.id                                                    as budget_id,
  b.userid,
  b.budget_month,
  c.id                                                    as category_id,
  c.category_name,
  c.icon                                                  as category_icon,
  c.color                                                 as category_color,
  cg.id                                                   as group_id,
  cg.name                                                 as group_name,
  b.budget_amount,
  coalesce(s.actual_spend, 0)                             as actual_spend,
  b.budget_amount - coalesce(s.actual_spend, 0)           as remaining,
  case
    when b.budget_amount > 0
    then round(coalesce(s.actual_spend, 0) / b.budget_amount * 100, 1)
  end                                                     as pct_used,
  coalesce(s.actual_spend, 0) > b.budget_amount           as is_over_budget,
  coalesce(s.transaction_count, 0)                        as transaction_count,
  case
    when b.budget_amount = 0 and coalesce(s.actual_spend, 0) = 0 then 'Unbudgeted'
    when b.budget_amount = 0                                     then 'Over'
    when r.ratio >= 1.0                                          then 'Over'
    when r.ratio >= 0.8                                          then 'Near Limit'
    else                                                              'On Track'
  end                                                     as status,
  case
    when b.budget_amount = 0 and coalesce(s.actual_spend, 0) = 0 then 0
    when b.budget_amount = 0                                     then 3
    when r.ratio >= 1.0                                          then 3
    when r.ratio >= 0.8                                          then 2
    else                                                              1
  end                                                     as status_rank
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
) s on true
left join lateral (
  select case when b.budget_amount > 0
              then coalesce(s.actual_spend, 0) / b.budget_amount end as ratio
) r on true;

-- ---------------------------------------------------------------------
-- 4. v_monthly_cashflow   (Transfers excluded: neither income nor spend)
-- ---------------------------------------------------------------------
create view public.v_monthly_cashflow
with (security_invoker = true) as
select
  t.userid,
  date_trunc('month', t.transaction_date)::date                             as month,
  coalesce(sum(t.amount) filter (where t.transaction_type = 'Income'), 0)   as income,
  coalesce(sum(t.amount) filter (where t.transaction_type = 'Expense'), 0)  as expenses,
  coalesce(sum(t.amount) filter (where t.transaction_type = 'Income'), 0)
    - coalesce(sum(t.amount) filter (where t.transaction_type = 'Expense'), 0) as net_cashflow,
  case
    when coalesce(sum(t.amount) filter (where t.transaction_type = 'Income'), 0) > 0
    then round(
      (coalesce(sum(t.amount) filter (where t.transaction_type = 'Income'), 0)
       - coalesce(sum(t.amount) filter (where t.transaction_type = 'Expense'), 0))
      / sum(t.amount) filter (where t.transaction_type = 'Income') * 100, 1)
  end                                                                       as savings_rate_pct,
  count(*) filter (where t.transaction_type = 'Income')                     as income_count,
  count(*) filter (where t.transaction_type = 'Expense')                    as expense_count
from transactions t
where t.transaction_type in ('Income', 'Expense')
group by t.userid, date_trunc('month', t.transaction_date)::date;

-- ---------------------------------------------------------------------
-- 5. v_category_spending
-- ---------------------------------------------------------------------
create view public.v_category_spending
with (security_invoker = true) as
select
  t.userid,
  date_trunc('month', t.transaction_date)::date  as month,
  cg.id                                          as group_id,
  cg.name                                        as group_name,
  cg.sort_order                                  as group_sort_order,
  c.id                                           as category_id,
  c.category_name,
  c.icon                                         as category_icon,
  c.color                                        as category_color,
  sum(t.amount)                                  as total_spend,
  count(*)                                       as transaction_count,
  round(avg(t.amount), 2)                        as avg_transaction,
  max(t.amount)                                  as largest_transaction,
  round(
    100 * sum(t.amount) / nullif(
      sum(sum(t.amount)) over (
        partition by t.userid, date_trunc('month', t.transaction_date)
      ), 0), 1)                                  as pct_of_month
from transactions t
join categories c       on c.id  = t.categoryid
join category_groups cg on cg.id = c.groupid
where t.transaction_type = 'Expense'
group by
  t.userid, date_trunc('month', t.transaction_date),
  cg.id, cg.name, cg.sort_order,
  c.id, c.category_name, c.icon, c.color;

-- ---------------------------------------------------------------------
-- 6. v_goal_progress
-- ---------------------------------------------------------------------
create view public.v_goal_progress
with (security_invoker = true) as
select
  g.id                                            as goal_id,
  g.userid,
  g.goal_name,
  g.goal_type,
  g.status,
  g.tracking_method,
  g.accountid,
  g.target_amount,
  g.target_date,
  g.monthly_contribution,
  g.current_amount                                as stored_amount,
  coalesce(c.contributed, 0)                      as contributed_amount,
  greatest(g.target_amount - coalesce(c.contributed, 0), 0) as remaining_amount,
  round(least(coalesce(c.contributed, 0) / nullif(g.target_amount, 0), 1) * 100, 1)
                                                  as pct_complete,
  coalesce(c.contribution_count, 0)               as contribution_count,
  c.last_contribution_date,
  case
    when coalesce(c.contributed, 0) >= g.target_amount then current_date
    when g.monthly_contribution > 0 then
      (current_date + (ceil(
        (g.target_amount - coalesce(c.contributed, 0)) / g.monthly_contribution
      ) * interval '1 month'))::date
  end                                             as projected_completion_date,
  case
    when g.target_date is null then null
    when coalesce(c.contributed, 0) >= g.target_amount then true
    when g.monthly_contribution > 0 then
      (current_date + (ceil(
        (g.target_amount - coalesce(c.contributed, 0)) / g.monthly_contribution
      ) * interval '1 month'))::date <= g.target_date
    else false
  end                                             as is_on_track
from goals g
left join lateral (
  select sum(gc.amount) as contributed,
         count(*)       as contribution_count,
         max(gc.date)   as last_contribution_date
  from goal_contributions gc
  where gc.goalid = g.id
) c on true;

-- ---------------------------------------------------------------------
-- 7. v_investment_holdings
-- ---------------------------------------------------------------------
create view public.v_investment_holdings
with (security_invoker = true) as
select
  i.id                                            as investment_id,
  i.userid,
  i.accountid,
  a.account_name,
  i.ticker,
  i.asset_type,
  i.shares,
  i.average_cost,
  i.current_price,
  (i.current_price is null)                       as price_is_stale,
  (i.shares > 0)                                  as is_open,
  round(i.shares * i.average_cost, 2)             as cost_basis,
  round(i.shares * coalesce(i.current_price, i.average_cost), 2)   as market_value,
  round(i.shares * (coalesce(i.current_price, i.average_cost) - i.average_cost), 2)
                                                  as unrealized_gain_loss,
  case
    when i.average_cost > 0
    then round((coalesce(i.current_price, i.average_cost) - i.average_cost)
               / i.average_cost * 100, 2)
  end                                             as unrealized_pct
from investments i
join accounts a on a.id = i.accountid;

-- ---------------------------------------------------------------------
-- 8. v_portfolio_summary
-- ---------------------------------------------------------------------
create view public.v_portfolio_summary
with (security_invoker = true) as
select
  h.userid,
  h.accountid,
  h.account_name,
  count(*)                                        as holding_count,
  count(*) filter (where h.price_is_stale)        as stale_price_count,
  sum(h.cost_basis)                               as total_cost_basis,
  sum(h.market_value)                             as total_market_value,
  sum(h.unrealized_gain_loss)                     as total_unrealized_gain_loss,
  case
    when sum(h.cost_basis) > 0
    then round(sum(h.unrealized_gain_loss) / sum(h.cost_basis) * 100, 2)
  end                                             as total_return_pct,
  round(100 * sum(h.market_value) / nullif(
    sum(sum(h.market_value)) over (partition by h.userid), 0), 1) as pct_of_portfolio
from public.v_investment_holdings h
where h.is_open
group by h.userid, h.accountid, h.account_name;

-- ---------------------------------------------------------------------
-- 9. v_upcoming_recurring
-- ---------------------------------------------------------------------
create view public.v_upcoming_recurring
with (security_invoker = true) as
select
  r.id                                            as recurring_id,
  r.userid,
  r.description,
  r.amount,
  r.frequency,
  r.next_run_date,
  r.start_date,
  r.end_date,
  r.accountid,
  a.account_name,
  a.color                                         as account_color,
  r.categoryid,
  c.category_name,
  c.icon                                          as category_icon,
  c.color                                         as category_color,
  (r.next_run_date - current_date)                as days_until,
  (r.next_run_date < current_date)                as is_overdue
from recurring_transactions r
join accounts a   on a.id = r.accountid
join categories c on c.id = r.categoryid
where r.is_active
  and (r.end_date is null or r.end_date >= current_date);

-- ---------------------------------------------------------------------
-- 10. v_daily_cashflow
-- Only days with transactions produce rows; a continuous axis needs
-- gap-filling client-side. running_net is cumulative over all history.
-- ---------------------------------------------------------------------
create view public.v_daily_cashflow
with (security_invoker = true) as
select
  t.userid,
  t.transaction_date                                                        as day,
  coalesce(sum(t.amount) filter (where t.transaction_type = 'Income'), 0)   as income,
  coalesce(sum(t.amount) filter (where t.transaction_type = 'Expense'), 0)  as expenses,
  coalesce(sum(t.amount) filter (where t.transaction_type = 'Income'), 0)
    - coalesce(sum(t.amount) filter (where t.transaction_type = 'Expense'), 0) as net_cashflow,
  count(*)                                                                  as transaction_count,
  sum(
    coalesce(sum(t.amount) filter (where t.transaction_type = 'Income'), 0)
    - coalesce(sum(t.amount) filter (where t.transaction_type = 'Expense'), 0)
  ) over (partition by t.userid order by t.transaction_date
          rows between unbounded preceding and current row)                 as running_net
from transactions t
where t.transaction_type in ('Income', 'Expense')
group by t.userid, t.transaction_date;

-- ---------------------------------------------------------------------
-- 11. v_goals_summary
-- ---------------------------------------------------------------------
create view public.v_goals_summary
with (security_invoker = true) as
select
  g.userid,
  count(*)                                                          as total_goals,
  count(*) filter (where g.status = 'Active')                       as active_goals,
  count(*) filter (where g.status = 'Completed')                    as completed_goals,
  count(*) filter (where g.status = 'Active' and g.is_on_track)     as goals_on_track,
  count(*) filter (where g.status = 'Active' and g.is_on_track is false)
                                                                    as goals_off_track,
  coalesce(sum(g.target_amount)        filter (where g.status = 'Active'), 0) as total_target,
  coalesce(sum(g.contributed_amount)   filter (where g.status = 'Active'), 0) as total_saved,
  coalesce(sum(g.remaining_amount)     filter (where g.status = 'Active'), 0) as total_remaining,
  coalesce(sum(g.monthly_contribution) filter (where g.status = 'Active'), 0)
                                                                    as planned_monthly_contribution,
  coalesce(m.contributed_this_month, 0)                             as contributed_this_month,
  case
    when sum(g.target_amount) filter (where g.status = 'Active') > 0
    then round(
      sum(g.contributed_amount) filter (where g.status = 'Active')
      / sum(g.target_amount)    filter (where g.status = 'Active') * 100, 1)
  end                                                               as overall_pct_complete
from public.v_goal_progress g
left join lateral (
  select sum(gc.amount) as contributed_this_month
    from goal_contributions gc
    join goals g2 on g2.id = gc.goalid
   where g2.userid = g.userid
     and gc.date >= date_trunc('month', current_date)::date
     and gc.date <  (date_trunc('month', current_date) + interval '1 month')::date
) m on true
group by g.userid, m.contributed_this_month;

-- ---------------------------------------------------------------------
-- 12. v_dashboard_kpis
-- Month-scoped because the dashboard mock has no date picker.
-- Spined on profiles so a new user with no accounts gets zeros, not
-- an absent row.
-- ---------------------------------------------------------------------
create view public.v_dashboard_kpis
with (security_invoker = true) as
select
  p.id                                              as userid,
  date_trunc('month', current_date)::date           as period_month,
  coalesce(bal.cash_balance, 0)                     as cash_balance,
  coalesce(bal.investment_balance, 0)               as investment_balance,
  coalesce(nw.total_assets, 0)                      as total_assets,
  coalesce(nw.total_liabilities, 0)                 as total_liabilities,
  coalesce(nw.net_worth, 0)                         as net_worth,
  coalesce(cf.income, 0)                            as total_earned,
  coalesce(cf.expenses, 0)                          as total_spent,
  coalesce(cf.income, 0) - coalesce(cf.expenses, 0) as net_cashflow,
  case
    when coalesce(cf.income, 0) > 0
    then round((cf.income - cf.expenses) / cf.income * 100, 1)
  end                                               as savings_rate_pct,
  coalesce(cf.transaction_count, 0)                 as transaction_count
from profiles p
left join lateral (
  select n.total_assets, n.total_liabilities, n.net_worth
  from public.v_net_worth n where n.userid = p.id
) nw on true
left join lateral (
  select
    sum(b.balance) filter (where b.account_type in ('Checking', 'Savings', 'Cash'))
      as cash_balance,
    sum(b.balance) filter (where b.account_type = 'Investment')
      as investment_balance
  from public.v_account_balances b
  where b.userid = p.id and b.is_active
) bal on true
left join lateral (
  select
    sum(t.amount) filter (where t.transaction_type = 'Income')  as income,
    sum(t.amount) filter (where t.transaction_type = 'Expense') as expenses,
    count(*)                                                    as transaction_count
  from transactions t
  where t.userid = p.id
    and t.transaction_type in ('Income', 'Expense')
    and t.transaction_date >= date_trunc('month', current_date)::date
    and t.transaction_date <  (date_trunc('month', current_date) + interval '1 month')::date
) cf on true;

-- ---------------------------------------------------------------------
-- 13. v_integrity_issues
-- ---------------------------------------------------------------------
create view public.v_integrity_issues
with (security_invoker = true) as
select
  'account_balance_drift'::text  as issue_type,
  'high'::text                   as severity,
  'accounts'::text               as table_name,
  b.account_id                   as record_id,
  b.userid,
  format('%s: stored %s, computed %s (delta %s)',
         b.account_name, b.stored_balance, b.balance,
         b.stored_balance - b.balance) as detail
from public.v_account_balances b
where b.stored_balance is distinct from b.balance

union all

select 'goal_amount_drift', 'high', 'goals', g.goal_id, g.userid,
       format('%s: stored %s, contributed %s (delta %s)',
              g.goal_name, g.stored_amount, g.contributed_amount,
              g.stored_amount - g.contributed_amount)
from public.v_goal_progress g
where g.stored_amount is distinct from g.contributed_amount

union all

select 'contribution_amount_mismatch', 'medium', 'goal_contributions',
       gc.id, t.userid,
       format('contribution %s vs transaction %s', gc.amount, t.amount)
from goal_contributions gc
join transactions t on t.id = gc.transactionid
where gc.amount is distinct from t.amount

union all

select 'missing_price', 'low', 'investments', i.investment_id, i.userid,
       format('%s (%s): %s shares held, no current_price',
              i.ticker, i.asset_type, i.shares)
from public.v_investment_holdings i
where i.price_is_stale and i.is_open

union all

select 'recurring_overdue', 'medium', 'recurring_transactions',
       r.recurring_id, r.userid,
       format('%s was due %s (%s days ago)',
              r.description, r.next_run_date, abs(r.days_until))
from public.v_upcoming_recurring r
where r.is_overdue;


-- =====================================================================
-- STEP 7 -- Grants
-- =====================================================================

do $$
declare v text;
begin
  foreach v in array array[
    'v_account_balances', 'v_net_worth', 'v_budget_vs_actual',
    'v_monthly_cashflow', 'v_category_spending', 'v_goal_progress',
    'v_investment_holdings', 'v_portfolio_summary', 'v_upcoming_recurring',
    'v_daily_cashflow', 'v_goals_summary', 'v_dashboard_kpis',
    'v_integrity_issues'
  ] loop
    execute format('revoke all on public.%I from anon', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;


-- =====================================================================
-- STEP 8 -- Verify
-- =====================================================================

-- No familyid anywhere. Both queries must return zero rows.
select table_name, column_name
  from information_schema.columns
 where table_schema = 'public' and column_name = 'familyid';

select conrelid::regclass as table_name, conname
  from pg_constraint
 where connamespace = 'public'::regnamespace
   and pg_get_constraintdef(oid) ilike '%familyid%';

-- All 13 views present and security_invoker = true.
select c.relname as view_name,
       coalesce((select option_value from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker'), 'false') as security_invoker
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'v'
 order by 2, 1;

-- Smoke test: none should error.
-- select 'v_account_balances' as v, count(*) from public.v_account_balances
-- union all select 'v_net_worth',           count(*) from public.v_net_worth
-- union all select 'v_budget_vs_actual',    count(*) from public.v_budget_vs_actual
-- union all select 'v_monthly_cashflow',    count(*) from public.v_monthly_cashflow
-- union all select 'v_category_spending',   count(*) from public.v_category_spending
-- union all select 'v_goal_progress',       count(*) from public.v_goal_progress
-- union all select 'v_investment_holdings', count(*) from public.v_investment_holdings
-- union all select 'v_portfolio_summary',   count(*) from public.v_portfolio_summary
-- union all select 'v_upcoming_recurring',  count(*) from public.v_upcoming_recurring
-- union all select 'v_daily_cashflow',      count(*) from public.v_daily_cashflow
-- union all select 'v_goals_summary',       count(*) from public.v_goals_summary
-- union all select 'v_dashboard_kpis',      count(*) from public.v_dashboard_kpis
-- union all select 'v_integrity_issues',    count(*) from public.v_integrity_issues;


-- =====================================================================
-- NOTE
--
-- The composite (id, familyid) foreign keys are gone. They were the only
-- thing stopping a user from stamping a row with someone else's
-- familyid -- irrelevant now, but worth remembering if households ever
-- come back: re-adding the column is easy, re-adding the guarantees is
-- the migration in the earlier file.
--
-- Single-column FKs (userid, accountid, categoryid, groupid, goalid,
-- transactionid, recurringid) are untouched and unaffected.
-- =====================================================================
