-- =====================================================================
-- EverNest 04: hardening
--
-- RUN AFTER 03_signup_pipeline.sql.
--
--   1. Drop accounts.current_balance and goals.current_amount. Balances
--      come from the views from now on -- the drift class disappears
--      rather than being monitored.
--   2. goal_contributions.transactionid -> nullable (unblocks Manual goals)
--   3. categories.category_type + enforcement trigger
--   4. The remaining CHECK constraints
--   5. ON DELETE rules on every foreign key
--   6. Indexes on FK columns (regression from migration 01)
--   7. updated_at triggers
--   8. Views rebuilt without the dropped columns
--
-- RUN STEP 0 FIRST. It reports data that would fail the new constraints.
-- Fix anything it returns before continuing, or step 4 aborts partway.
--
-- Take a fresh dump before starting -- step 2 discards data.
-- =====================================================================


-- =====================================================================
-- STEP 0 -- Pre-flight audit (read-only)
--
-- Every value listed here violates a constraint added in step 4.
-- Ideally returns nothing.
-- =====================================================================

select 'transactions.transaction_type' as column_ref, transaction_type as bad_value, count(*)
  from transactions where transaction_type not in ('Income','Expense') group by 2
union all
select 'investments.asset_type', asset_type, count(*)
  from investments where asset_type not in ('Stock','ETF','Crypto','Bond','Mutual Fund','Other') group by 2
union all
select 'recurring_transactions.frequency', frequency, count(*)
  from recurring_transactions
 where frequency not in ('Daily','Weekly','Biweekly','Monthly','Quarterly','Yearly') group by 2
union all
select 'goals.status', status, count(*)
  from goals where status not in ('Active','Paused','Completed','Cancelled') group by 2
union all
select 'subscriptions.plan', plan, count(*)
  from subscriptions where plan not in ('Free','Pro','Premium') group by 2
union all
select 'subscriptions.status', status, count(*)
  from subscriptions
 where status not in ('Active','Trialing','PastDue','Canceled','Incomplete') group by 2
union all
select 'accounts.account_type', account_type, count(*)
  from accounts
 where account_type not in ('Checking','Savings','Credit Card','Loan','Investment','Cash') group by 2
order by 1, 2;

-- Numeric violations
select 'budgets.budget_amount < 0' as check_ref, count(*) from budgets where budget_amount < 0
union all select 'goals.target_amount <= 0',      count(*) from goals where target_amount <= 0
union all select 'investments.shares < 0',        count(*) from investments where shares < 0
union all select 'goal_contributions.amount <= 0',count(*) from goal_contributions where amount <= 0
union all select 'transactions.amount < 0',       count(*) from transactions where amount < 0;

-- !! TRANSFER CHECK !!
-- Step 4 restricts transaction_type to Income/Expense. 'Transfer' is
-- excluded on purpose: transactions has no counterparty column, so a
-- transfer debits one account and credits nothing, silently corrupting
-- the other side's balance. If the first query above shows Transfer
-- rows, STOP -- either convert them or add the counterparty schema first.


-- =====================================================================
-- STEP 1 -- Drop views
--
-- They reference the columns being dropped. Rebuilt in step 8.
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


-- =====================================================================
-- STEP 2 -- Drop the stored aggregates
--
-- DESTRUCTIVE. These columns held a cached total that nothing
-- maintained; from here the number is always computed from history and
-- cannot be wrong.
--
-- opening_balance stays -- it is real input data, not a cache.
-- =====================================================================

alter table accounts drop column current_balance;
alter table goals    drop column current_amount;


-- =====================================================================
-- STEP 3 -- Unblock manual goal tracking
--
-- tracking_method = 'Manual' means progress is entered by hand with no
-- backing transaction. NOT NULL made that impossible.
-- =====================================================================

alter table goal_contributions alter column transactionid drop not null;


-- =====================================================================
-- STEP 4a -- categories.category_type
--
-- Without this, "Salary" is offered as a budgetable category and can be
-- picked as the category for an expense.
--
-- Backfill: anything under the seeded "Income" group becomes Income,
-- everything else Expense. Review the result before trusting it if you
-- created categories by hand.
-- =====================================================================

alter table categories
  add column if not exists category_type text not null default 'Expense';

update categories c
   set category_type = 'Income'
  from category_groups cg
 where cg.id = c.groupid and cg.name = 'Income';

alter table categories
  drop constraint if exists categories_category_type_check;
alter table categories
  add constraint categories_category_type_check
  check (category_type in ('Income','Expense'));

-- Keep the signup seed consistent with the new column.
create or replace function public.seed_default_categories(p_userid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if exists (select 1 from public.category_groups where userid = p_userid) then
    return;
  end if;

  with g as (
    insert into public.category_groups (userid, name, sort_order)
    values
      (p_userid,'Income',0),(p_userid,'Housing',1),(p_userid,'Transportation',2),
      (p_userid,'Food',3),(p_userid,'Personal',4),(p_userid,'Health',5),
      (p_userid,'Entertainment',6),(p_userid,'Financial',7),(p_userid,'Other',8)
    returning id, name
  )
  insert into public.categories (userid, groupid, category_name, icon, color, category_type)
  select p_userid, g.id, v.category_name, v.icon, v.color, v.category_type
    from g
    join (values
      ('Income','Salary','banknote','#10B981','Income'),
      ('Income','Bonus','gift','#10B981','Income'),
      ('Income','Interest','percent','#10B981','Income'),
      ('Income','Other Income','plus-circle','#10B981','Income'),
      ('Housing','Rent / Mortgage','home','#F59E0B','Expense'),
      ('Housing','Utilities','zap','#F59E0B','Expense'),
      ('Housing','Home Maintenance','wrench','#F59E0B','Expense'),
      ('Housing','Home Insurance','shield','#F59E0B','Expense'),
      ('Transportation','Gas','fuel','#3B82F6','Expense'),
      ('Transportation','Car Payment','car','#3B82F6','Expense'),
      ('Transportation','Public Transit','train-front','#3B82F6','Expense'),
      ('Transportation','Parking','circle-parking','#3B82F6','Expense'),
      ('Transportation','Car Maintenance','wrench','#3B82F6','Expense'),
      ('Food','Groceries','shopping-cart','#EF4444','Expense'),
      ('Food','Restaurants','utensils','#EF4444','Expense'),
      ('Food','Coffee','coffee','#EF4444','Expense'),
      ('Personal','Clothing','shirt','#8B5CF6','Expense'),
      ('Personal','Personal Care','scissors','#8B5CF6','Expense'),
      ('Personal','Fitness','dumbbell','#8B5CF6','Expense'),
      ('Personal','Subscriptions','repeat','#8B5CF6','Expense'),
      ('Health','Medical','stethoscope','#EC4899','Expense'),
      ('Health','Dental','smile','#EC4899','Expense'),
      ('Health','Pharmacy','pill','#EC4899','Expense'),
      ('Health','Health Insurance','heart-pulse','#EC4899','Expense'),
      ('Entertainment','Streaming','tv','#06B6D4','Expense'),
      ('Entertainment','Hobbies','palette','#06B6D4','Expense'),
      ('Entertainment','Travel','plane','#06B6D4','Expense'),
      ('Entertainment','Events','ticket','#06B6D4','Expense'),
      ('Financial','Savings','piggy-bank','#14B8A6','Expense'),
      ('Financial','Investments','trending-up','#14B8A6','Expense'),
      ('Financial','Debt Payment','credit-card','#14B8A6','Expense'),
      ('Financial','Fees','receipt','#14B8A6','Expense'),
      ('Other','Gifts','gift','#6B7280','Expense'),
      ('Other','Charity','heart','#6B7280','Expense'),
      ('Other','Miscellaneous','circle-ellipsis','#6B7280','Expense')
    ) as v(group_name, category_name, icon, color, category_type)
      on v.group_name = g.name;
end;
$fn$;


-- =====================================================================
-- STEP 4b -- Enforce transaction type against category type
--
-- A CHECK constraint cannot reference another table, so this is a
-- trigger. categories.id is the primary key, so the lookup is an index
-- hit on every transaction write -- acceptable, and the alternative
-- (denormalising category_type onto transactions and using a composite
-- FK) reintroduces exactly the duplication the families work removed.
-- =====================================================================

create or replace function public.enforce_category_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_type text;
begin
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

drop trigger if exists trg_transactions_category_type on transactions;
create trigger trg_transactions_category_type
  before insert or update of categoryid, transaction_type on transactions
  for each row execute function public.enforce_category_type();


-- =====================================================================
-- STEP 5 -- Remaining CHECK constraints
--
-- NOT VALID then VALIDATE throughout: brief lock to start enforcing,
-- then a scan under a weaker lock that does not block reads or writes.
-- =====================================================================

-- Enumerated text
alter table transactions drop constraint if exists transactions_type_check;
alter table transactions add  constraint transactions_type_check
  check (transaction_type in ('Income','Expense')) not valid;

alter table investments drop constraint if exists investments_asset_type_check;
alter table investments add  constraint investments_asset_type_check
  check (asset_type in ('Stock','ETF','Crypto','Bond','Mutual Fund','Other')) not valid;

alter table recurring_transactions drop constraint if exists rectx_frequency_check;
alter table recurring_transactions add  constraint rectx_frequency_check
  check (frequency in ('Daily','Weekly','Biweekly','Monthly','Quarterly','Yearly')) not valid;

alter table goals drop constraint if exists goals_status_check;
alter table goals add  constraint goals_status_check
  check (status in ('Active','Paused','Completed','Cancelled')) not valid;

alter table accounts drop constraint if exists accounts_account_type_check;
alter table accounts add  constraint accounts_account_type_check
  check (account_type in ('Checking','Savings','Credit Card','Loan','Investment','Cash')) not valid;

alter table subscriptions drop constraint if exists subscriptions_plan_check;
alter table subscriptions add  constraint subscriptions_plan_check
  check (plan in ('Free','Pro','Premium')) not valid;

alter table subscriptions drop constraint if exists subscriptions_status_check;
alter table subscriptions add  constraint subscriptions_status_check
  check (status in ('Active','Trialing','PastDue','Canceled','Incomplete')) not valid;

alter table profiles drop constraint if exists profiles_subscription_plan_check;
alter table profiles add  constraint profiles_subscription_plan_check
  check (subscription_plan is null or subscription_plan in ('Free','Pro','Premium')) not valid;

alter table profiles drop constraint if exists profiles_subscription_status_check;
alter table profiles add  constraint profiles_subscription_status_check
  check (subscription_status is null
         or subscription_status in ('Active','Trialing','PastDue','Canceled','Incomplete')) not valid;

-- Numeric sanity
alter table budgets drop constraint if exists budgets_amount_nonneg;
alter table budgets add  constraint budgets_amount_nonneg
  check (budget_amount >= 0) not valid;

alter table transactions drop constraint if exists transactions_amount_nonneg;
alter table transactions add  constraint transactions_amount_nonneg
  check (amount >= 0) not valid;

alter table goals drop constraint if exists goals_target_positive;
alter table goals add  constraint goals_target_positive
  check (target_amount > 0) not valid;

alter table goals drop constraint if exists goals_monthly_nonneg;
alter table goals add  constraint goals_monthly_nonneg
  check (monthly_contribution is null or monthly_contribution >= 0) not valid;

alter table goal_contributions drop constraint if exists goal_contrib_amount_positive;
alter table goal_contributions add  constraint goal_contrib_amount_positive
  check (amount > 0) not valid;

alter table investments drop constraint if exists investments_numeric_sane;
alter table investments add  constraint investments_numeric_sane
  check (shares >= 0 and average_cost >= 0
         and (current_price is null or current_price >= 0)) not valid;

-- Settings ranges
alter table settings drop constraint if exists settings_week_start_range;
alter table settings add  constraint settings_week_start_range
  check (week_start between 0 and 6) not valid;

alter table settings drop constraint if exists settings_budget_month_range;
alter table settings add  constraint settings_budget_month_range
  check (default_budget_month is null or default_budget_month between 1 and 12) not valid;

alter table settings drop constraint if exists settings_currency_format;
alter table settings add  constraint settings_currency_format
  check (currency ~ '^[A-Z]{3}$') not valid;

-- Colour hex
alter table accounts drop constraint if exists accounts_color_hex;
alter table accounts add  constraint accounts_color_hex
  check (color is null or color ~* '^#[0-9A-F]{6}$') not valid;

alter table categories drop constraint if exists categories_color_hex;
alter table categories add  constraint categories_color_hex
  check (color is null or color ~* '^#[0-9A-F]{6}$') not valid;

-- Date ordering
alter table recurring_transactions drop constraint if exists rectx_date_order;
alter table recurring_transactions add  constraint rectx_date_order
  check (end_date is null or start_date is null or end_date >= start_date) not valid;

-- Budget months must be the first of the month, or the UNIQUE key on
-- (userid, categoryid, budget_month) lets July appear twice.
alter table budgets drop constraint if exists budgets_month_is_first;
alter table budgets add  constraint budgets_month_is_first
  check (budget_month = date_trunc('month', budget_month)::date) not valid;

-- Validate all of the above.
alter table transactions           validate constraint transactions_type_check;
alter table transactions           validate constraint transactions_amount_nonneg;
alter table investments            validate constraint investments_asset_type_check;
alter table investments            validate constraint investments_numeric_sane;
alter table recurring_transactions validate constraint rectx_frequency_check;
alter table recurring_transactions validate constraint rectx_date_order;
alter table goals                  validate constraint goals_status_check;
alter table goals                  validate constraint goals_target_positive;
alter table goals                  validate constraint goals_monthly_nonneg;
alter table accounts               validate constraint accounts_account_type_check;
alter table accounts               validate constraint accounts_color_hex;
alter table subscriptions          validate constraint subscriptions_plan_check;
alter table subscriptions          validate constraint subscriptions_status_check;
alter table profiles               validate constraint profiles_subscription_plan_check;
alter table profiles               validate constraint profiles_subscription_status_check;
alter table budgets                validate constraint budgets_amount_nonneg;
alter table budgets                validate constraint budgets_month_is_first;
alter table goal_contributions     validate constraint goal_contrib_amount_positive;
alter table settings               validate constraint settings_week_start_range;
alter table settings               validate constraint settings_budget_month_range;
alter table settings               validate constraint settings_currency_format;
alter table categories             validate constraint categories_color_hex;


-- =====================================================================
-- STEP 6 -- ON DELETE rules
--
-- Policy, and the reasoning:
--
--   userid -> profiles          CASCADE   deleting a user removes their data
--   accountid -> accounts       RESTRICT  accounts have is_active; soft-delete
--                                         is the intended path. Blocking a
--                                         hard delete stops silent loss of
--                                         transaction history.
--   categoryid/groupid          RESTRICT  same reasoning (is_active exists)
--   transactions.goalid         SET NULL  deleting a goal must not delete
--                                         real spending history
--   transactions.recurringid    SET NULL  deleting a template must not delete
--                                         the transactions it produced
--   goals.accountid             SET NULL  already nullable
--   goal_contributions.goalid   CASCADE   a contribution has no meaning
--                                         without its goal
--   goal_contributions.transactionid CASCADE
-- =====================================================================

-- userid -> profiles : CASCADE
alter table accounts               drop constraint if exists accounts_userid_fkey;
alter table accounts               add  constraint accounts_userid_fkey
  foreign key (userid) references profiles(id) on delete cascade;

alter table budgets                drop constraint if exists budgets_userid_fkey;
alter table budgets                add  constraint budgets_userid_fkey
  foreign key (userid) references profiles(id) on delete cascade;

alter table categories             drop constraint if exists categories_userid_fkey;
alter table categories             add  constraint categories_userid_fkey
  foreign key (userid) references profiles(id) on delete cascade;

alter table category_groups        drop constraint if exists category_groups_userid_fkey;
alter table category_groups        add  constraint category_groups_userid_fkey
  foreign key (userid) references profiles(id) on delete cascade;

alter table goals                  drop constraint if exists goals_userid_fkey;
alter table goals                  add  constraint goals_userid_fkey
  foreign key (userid) references profiles(id) on delete cascade;

alter table investments            drop constraint if exists investments_userid_fkey;
alter table investments            add  constraint investments_userid_fkey
  foreign key (userid) references profiles(id) on delete cascade;

alter table notifications          drop constraint if exists notifications_userid_fkey;
alter table notifications          add  constraint notifications_userid_fkey
  foreign key (userid) references profiles(id) on delete cascade;

alter table recurring_transactions drop constraint if exists recurring_transactions_userid_fkey;
alter table recurring_transactions add  constraint recurring_transactions_userid_fkey
  foreign key (userid) references profiles(id) on delete cascade;

alter table settings               drop constraint if exists settings_userid_fkey;
alter table settings               add  constraint settings_userid_fkey
  foreign key (userid) references profiles(id) on delete cascade;

alter table subscriptions          drop constraint if exists subscriptions_userid_fkey;
alter table subscriptions          add  constraint subscriptions_userid_fkey
  foreign key (userid) references profiles(id) on delete cascade;

alter table transactions           drop constraint if exists transactions_userid_fkey;
alter table transactions           add  constraint transactions_userid_fkey
  foreign key (userid) references profiles(id) on delete cascade;

-- Structural parents : RESTRICT
alter table transactions           drop constraint if exists transactions_accountid_fkey;
alter table transactions           add  constraint transactions_accountid_fkey
  foreign key (accountid) references accounts(id) on delete restrict;

alter table transactions           drop constraint if exists transactions_categoryid_fkey;
alter table transactions           add  constraint transactions_categoryid_fkey
  foreign key (categoryid) references categories(id) on delete restrict;

alter table investments            drop constraint if exists investments_accountid_fkey;
alter table investments            add  constraint investments_accountid_fkey
  foreign key (accountid) references accounts(id) on delete restrict;

alter table recurring_transactions drop constraint if exists recurring_transactions_accountid_fkey;
alter table recurring_transactions add  constraint recurring_transactions_accountid_fkey
  foreign key (accountid) references accounts(id) on delete restrict;

alter table recurring_transactions drop constraint if exists recurring_transactions_categoryid_fkey;
alter table recurring_transactions add  constraint recurring_transactions_categoryid_fkey
  foreign key (categoryid) references categories(id) on delete restrict;

alter table budgets                drop constraint if exists budgets_categoryid_fkey;
alter table budgets                add  constraint budgets_categoryid_fkey
  foreign key (categoryid) references categories(id) on delete cascade;

alter table categories             drop constraint if exists categories_groupid_fkey;
alter table categories             add  constraint categories_groupid_fkey
  foreign key (groupid) references category_groups(id) on delete restrict;

-- History-preserving : SET NULL
alter table transactions           drop constraint if exists transactions_goalid_fkey;
alter table transactions           add  constraint transactions_goalid_fkey
  foreign key (goalid) references goals(id) on delete set null;

alter table transactions           drop constraint if exists transactions_recurringid_fkey;
alter table transactions           add  constraint transactions_recurringid_fkey
  foreign key (recurringid) references recurring_transactions(id) on delete set null;

alter table goals                  drop constraint if exists goals_accountid_fkey;
alter table goals                  add  constraint goals_accountid_fkey
  foreign key (accountid) references accounts(id) on delete set null;

-- Dependent children : CASCADE
alter table goal_contributions     drop constraint if exists goal_contributions_goalid_fkey;
alter table goal_contributions     add  constraint goal_contributions_goalid_fkey
  foreign key (goalid) references goals(id) on delete cascade;

alter table goal_contributions     drop constraint if exists goal_contributions_transactionid_fkey;
alter table goal_contributions     add  constraint goal_contributions_transactionid_fkey
  foreign key (transactionid) references transactions(id) on delete cascade;


-- =====================================================================
-- STEP 7 -- FK indexes
--
-- Postgres does not index FK columns automatically. Migration 01 removed
-- the composite (userid, familyid) indexes along with the column, and
-- those were also serving plain userid lookups -- which every RLS policy
-- performs. Without these, each policy check is a sequential scan.
--
-- The CASCADE rules added in step 6 also scan the child table on every
-- parent delete, so these matter twice over.
-- =====================================================================

create index if not exists idx_accounts_userid            on accounts (userid);
create index if not exists idx_budgets_userid             on budgets (userid);
create index if not exists idx_budgets_categoryid         on budgets (categoryid);
create index if not exists idx_categories_userid          on categories (userid);
create index if not exists idx_categories_groupid         on categories (groupid);
create index if not exists idx_category_groups_userid     on category_groups (userid);
create index if not exists idx_goals_userid               on goals (userid);
create index if not exists idx_goals_accountid            on goals (accountid) where accountid is not null;
create index if not exists idx_goal_contrib_txid          on goal_contributions (transactionid) where transactionid is not null;
create index if not exists idx_investments_userid         on investments (userid);
create index if not exists idx_notifications_userid       on notifications (userid);
create index if not exists idx_notifications_unread       on notifications (userid, created_at desc) where not is_read;
create index if not exists idx_rectx_userid               on recurring_transactions (userid);
create index if not exists idx_rectx_accountid            on recurring_transactions (accountid);
create index if not exists idx_rectx_categoryid           on recurring_transactions (categoryid);
create index if not exists idx_settings_userid            on settings (userid);
create index if not exists idx_subscriptions_userid       on subscriptions (userid);
create index if not exists idx_tx_goalid                  on transactions (goalid) where goalid is not null;
create index if not exists idx_tx_recurringid             on transactions (recurringid) where recurringid is not null;
create index if not exists idx_tx_categoryid              on transactions (categoryid);

-- Stops a scheduled transaction posting twice for the same date.
create unique index if not exists recurring_tx_no_double_post
  on transactions (recurringid, transaction_date) where recurringid is not null;


-- =====================================================================
-- STEP 8 -- updated_at triggers
--
-- Five tables carry updated_at with a now() default and nothing
-- maintaining it, so it currently records creation time under a
-- misleading name.
-- =====================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

do $do$
declare t text;
begin
  foreach t in array array['accounts','goals','profiles','settings','transactions']
  loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$I', t);
    execute format(
      'create trigger trg_%1$s_updated_at before update on public.%1$I
         for each row execute function public.set_updated_at()', t);
  end loop;
end
$do$;


-- =====================================================================
-- STEP 9 -- Rebuild views
--
-- Changes from the previous definitions:
--   * v_account_balances loses stored_balance -- there is no stored
--     balance any more. `balance` is now the only answer.
--   * v_goal_progress loses stored_amount for the same reason.
--   * v_integrity_issues loses account_balance_drift and
--     goal_amount_drift. Those checks compared a cache against the
--     truth; with the cache gone they are not merely broken but
--     meaningless. Three checks remain.
-- =====================================================================

create view public.v_account_balances
with (security_invoker = true) as
select
  a.id as account_id, a.userid, a.account_name, a.account_type, a.institution,
  a.color, a.account_icon, a.is_active, a.opening_balance,
  a.opening_balance + coalesce(t.delta, 0)  as balance,
  coalesce(t.transaction_count, 0)          as transaction_count,
  t.first_transaction_date, t.last_transaction_date
from accounts a
left join lateral (
  select sum(public.signed_amount(tr.amount, tr.transaction_type)) as delta,
         count(*)                 as transaction_count,
         min(tr.transaction_date) as first_transaction_date,
         max(tr.transaction_date) as last_transaction_date
  from transactions tr where tr.accountid = a.id
) t on true;

create view public.v_net_worth
with (security_invoker = true) as
select
  b.userid,
  coalesce(sum(b.balance) filter (
    where b.account_type in ('Checking','Savings','Investment','Cash')), 0) as total_assets,
  coalesce(-sum(b.balance) filter (
    where b.account_type in ('Credit Card','Loan')), 0)                     as total_liabilities,
  coalesce(sum(b.balance), 0)                                               as net_worth,
  count(*)                                                                  as account_count
from public.v_account_balances b
where b.is_active
group by b.userid;

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
) s on true
left join lateral (
  select case when b.budget_amount > 0
              then coalesce(s.actual_spend,0) / b.budget_amount end as ratio
) r on true;

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
group by t.userid, date_trunc('month', t.transaction_date)::date;

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
group by t.userid, date_trunc('month', t.transaction_date),
         cg.id, cg.name, cg.sort_order, c.id, c.category_name, c.icon, c.color;

create view public.v_goal_progress
with (security_invoker = true) as
select
  g.id as goal_id, g.userid, g.goal_name, g.goal_type, g.status,
  g.tracking_method, g.accountid, g.target_amount, g.target_date,
  g.monthly_contribution,
  coalesce(c.contributed, 0)                               as contributed_amount,
  greatest(g.target_amount - coalesce(c.contributed,0), 0) as remaining_amount,
  round(least(coalesce(c.contributed,0) / nullif(g.target_amount,0), 1) * 100, 1) as pct_complete,
  coalesce(c.contribution_count, 0)                        as contribution_count,
  c.last_contribution_date,
  case
    when coalesce(c.contributed,0) >= g.target_amount then current_date
    when g.monthly_contribution > 0 then
      (current_date + (ceil((g.target_amount - coalesce(c.contributed,0))
                            / g.monthly_contribution) * interval '1 month'))::date
  end                                                      as projected_completion_date,
  case
    when g.target_date is null then null
    when coalesce(c.contributed,0) >= g.target_amount then true
    when g.monthly_contribution > 0 then
      (current_date + (ceil((g.target_amount - coalesce(c.contributed,0))
                            / g.monthly_contribution) * interval '1 month'))::date <= g.target_date
    else false
  end                                                      as is_on_track
from goals g
left join lateral (
  select sum(gc.amount) as contributed, count(*) as contribution_count,
         max(gc.date)   as last_contribution_date
  from goal_contributions gc where gc.goalid = g.id
) c on true;

create view public.v_investment_holdings
with (security_invoker = true) as
select
  i.id as investment_id, i.userid, i.accountid, a.account_name,
  i.ticker, i.asset_type, i.shares, i.average_cost, i.current_price,
  (i.current_price is null)           as price_is_stale,
  (i.shares > 0)                      as is_open,
  round(i.shares * i.average_cost, 2) as cost_basis,
  round(i.shares * coalesce(i.current_price, i.average_cost), 2) as market_value,
  round(i.shares * (coalesce(i.current_price, i.average_cost) - i.average_cost), 2)
                                      as unrealized_gain_loss,
  case when i.average_cost > 0
       then round((coalesce(i.current_price,i.average_cost) - i.average_cost)
                  / i.average_cost * 100, 2) end as unrealized_pct
from investments i
join accounts a on a.id = i.accountid;

create view public.v_portfolio_summary
with (security_invoker = true) as
select
  h.userid, h.accountid, h.account_name,
  count(*)                                 as holding_count,
  count(*) filter (where h.price_is_stale) as stale_price_count,
  sum(h.cost_basis)                        as total_cost_basis,
  sum(h.market_value)                      as total_market_value,
  sum(h.unrealized_gain_loss)              as total_unrealized_gain_loss,
  case when sum(h.cost_basis) > 0
       then round(sum(h.unrealized_gain_loss) / sum(h.cost_basis) * 100, 2) end as total_return_pct,
  round(100 * sum(h.market_value) / nullif(
    sum(sum(h.market_value)) over (partition by h.userid), 0), 1) as pct_of_portfolio
from public.v_investment_holdings h
where h.is_open
group by h.userid, h.accountid, h.account_name;

create view public.v_upcoming_recurring
with (security_invoker = true) as
select
  r.id as recurring_id, r.userid, r.description, r.amount, r.frequency,
  r.next_run_date, r.start_date, r.end_date,
  r.accountid, a.account_name, a.color as account_color,
  r.categoryid, c.category_name, c.icon as category_icon, c.color as category_color,
  (r.next_run_date - current_date) as days_until,
  (r.next_run_date < current_date) as is_overdue
from recurring_transactions r
join accounts a   on a.id = r.accountid
join categories c on c.id = r.categoryid
where r.is_active and (r.end_date is null or r.end_date >= current_date);

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
group by t.userid, t.transaction_date;

create view public.v_goals_summary
with (security_invoker = true) as
select
  g.userid,
  count(*)                                                      as total_goals,
  count(*) filter (where g.status='Active')                     as active_goals,
  count(*) filter (where g.status='Completed')                  as completed_goals,
  count(*) filter (where g.status='Active' and g.is_on_track)   as goals_on_track,
  count(*) filter (where g.status='Active' and g.is_on_track is false) as goals_off_track,
  coalesce(sum(g.target_amount)        filter (where g.status='Active'),0) as total_target,
  coalesce(sum(g.contributed_amount)   filter (where g.status='Active'),0) as total_saved,
  coalesce(sum(g.remaining_amount)     filter (where g.status='Active'),0) as total_remaining,
  coalesce(sum(g.monthly_contribution) filter (where g.status='Active'),0) as planned_monthly_contribution,
  coalesce(m.contributed_this_month, 0)                         as contributed_this_month,
  case when sum(g.target_amount) filter (where g.status='Active') > 0
       then round(sum(g.contributed_amount) filter (where g.status='Active')
                / sum(g.target_amount)      filter (where g.status='Active') * 100, 1) end
                                                                as overall_pct_complete
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
) cf on true;

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
where r.is_overdue;


-- =====================================================================
-- STEP 10 -- Grants
-- =====================================================================

do $do$
declare v text;
begin
  foreach v in array array[
    'v_account_balances','v_net_worth','v_budget_vs_actual','v_monthly_cashflow',
    'v_category_spending','v_goal_progress','v_investment_holdings',
    'v_portfolio_summary','v_upcoming_recurring','v_daily_cashflow',
    'v_goals_summary','v_dashboard_kpis','v_integrity_issues'
  ] loop
    execute format('revoke all on public.%I from anon', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end
$do$;


-- =====================================================================
-- STEP 11 -- Verify
-- =====================================================================

-- Columns are gone. Zero rows.
select table_name, column_name from information_schema.columns
 where table_schema='public'
   and (table_name='accounts' and column_name='current_balance'
     or table_name='goals'    and column_name='current_amount');

-- Every CHECK validated. convalidated must be true throughout.
select conrelid::regclass as table_name, conname, convalidated
  from pg_constraint
 where contype='c' and connamespace='public'::regnamespace
   and conname not like '%not_null%'
 order by 3, 1, 2;

-- No FK left without a delete rule ('a' = NO ACTION).
select conrelid::regclass as table_name, conname, confdeltype
  from pg_constraint
 where contype='f' and connamespace='public'::regnamespace and confdeltype='a'
 order by 1, 2;

-- No unindexed FK columns. Zero rows.
select c.conrelid::regclass as table_name, a.attname as unindexed_fk_column
  from pg_constraint c
  join unnest(c.conkey) with ordinality as k(attnum, ord) on true
  join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
 where c.contype='f' and c.connamespace='public'::regnamespace
   and not exists (select 1 from pg_index i
                    where i.indrelid=c.conrelid and a.attnum=i.indkey[0])
 order by 1, 2;

-- All 13 views present with security_invoker = true.
select c.relname as view_name,
       coalesce((select option_value from pg_options_to_table(c.reloptions)
                  where option_name='security_invoker'),'false') as security_invoker
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='v'
 order by 2, 1;

-- updated_at triggers: expect 5.
select tgrelid::regclass as table_name, tgname
  from pg_trigger where tgname like 'trg_%_updated_at' order by 1;


-- =====================================================================
-- STILL OPEN -- deliberate, not forgotten
--
--   TRANSFERS. transaction_type is now restricted to Income/Expense.
--   Supporting transfers needs a counterparty column (transfer_accountid
--   or a paired-row link) before the type can be re-admitted.
--
--   SUBSCRIPTION DUPLICATION. subscriptions.plan and
--   profiles.subscription_plan still both exist. Both are now
--   constrained to the same value set and both are service_role-only,
--   but your Stripe webhook has to write both or they diverge. Picking
--   one source of truth is still the cleaner end state.
--
--   APP CONTRACT CHANGE. Any code reading accounts.current_balance or
--   goals.current_amount must now read v_account_balances.balance and
--   v_goal_progress.contributed_amount. Nothing writes those numbers any
--   more -- that is the point.
-- =====================================================================
