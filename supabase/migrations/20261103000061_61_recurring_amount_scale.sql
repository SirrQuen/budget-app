-- =====================================================================
-- Sorrel 61: schedule amounts are money -- numeric(12,2)
--
-- docs/phase-7-findings.md, "Schedule amounts are unconstrained numeric".
--
-- recurring_transactions.amount and .next_amount were plain numeric while
-- transactions.amount is numeric(12,2). So a schedule could hold 1850,
-- 1850.00 or 12.345, and v_recurring_amounts/v_upcoming_recurring returned
-- money at whatever scale each source had. Now both columns are
-- numeric(12,2): a value is stored at two decimal places, rounded on write
-- exactly as transactions.amount is -- so a schedule and the transaction
-- confirmed from it can't disagree by a fraction of a cent.
--
-- Postgres won't retype a column a view reads, so the views that read it
-- are dropped and recreated around the ALTER. Dependents, enumerated on
-- sorrel-dev and production (2026-11-03, read-only, identical on both):
--
--   v_recurring_amounts   reads amount, next_amount            (migration 59)
--   v_upcoming_recurring  reads next_amount; v_recurring_amounts (migration 59)
--   v_integrity_issues    reads v_upcoming_recurring          (baseline)
--
-- Nothing depends on v_integrity_issues. No function, policy or column
-- grant reads either column. idx_recurring_amount is rebuilt by the ALTER;
-- the four next_amount CHECK constraints hold at the new type.
--
-- NO CASCADE. Each view is dropped by name, dependents first. If anything
-- else has come to depend on them, the drop fails and says what -- better
-- than a CASCADE that silently removes it.
--
-- The definitions are the current ones, unchanged (pg_get_viewdef hashes
-- matched on both databases), with one exception: v_recurring_amounts'
-- card balance owed, greatest(-balance, 0), is cast to numeric(12,2), so a
-- card that owes nothing reads 0.00 rather than 0. Every money value the
-- two views return now has scale 2.
--
-- Dropping a view loses its ACL and comments (the class of the --no-acl
-- baseline mistake), so both are restored explicitly below: the ACL
-- production has (the baseline's grants), and every comment that was on
-- them. This also corrects sorrel-dev, where v_recurring_amounts had
-- picked up INSERT/UPDATE/DELETE for authenticated and service_role from
-- that project's default privileges; production never had them.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. The cast must lose nothing. Production had none beyond two decimal
--    places on 2026-11-03; refuse rather than round if that has changed.
-- ---------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from public.recurring_transactions
     where amount <> round(amount, 2)
        or next_amount <> round(next_amount, 2)
  ) then
    raise exception 'migration 61: a schedule amount has more than two decimal places; it would be rounded. Look at it first.';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 1. Drop the dependents, outermost first. No CASCADE.
-- ---------------------------------------------------------------------

drop view public.v_integrity_issues;
drop view public.v_upcoming_recurring;
drop view public.v_recurring_amounts;

-- ---------------------------------------------------------------------
-- 2. Retype.
-- ---------------------------------------------------------------------

alter table public.recurring_transactions
  alter column amount      type numeric(12,2),
  alter column next_amount type numeric(12,2);

-- ---------------------------------------------------------------------
-- 3. v_recurring_amounts (migration 59; card balance cast to scale 2)
-- ---------------------------------------------------------------------

create view public.v_recurring_amounts with (security_invoker = true) as
select
  r.id as recurring_id,
  r.userid,
  e.amount,
  case
    when not r.amount_is_variable then 'fixed'
    when r.to_accountid is not null and r.next_amount_confirmed_at is not null then 'statement'
    when r.to_accountid is not null then 'card_balance'
    when e.three_supplied then 'average_of_3'
    else 'schedule'
  end as amount_basis,
  e.amount_low,
  e.amount_high,
  case
    when e.amount_high is not null then
      case
        when e.three_supplied then 'highest_of_3'
        when e.amount_high > r.amount then 'highest_so_far'
        else 'schedule'
      end
    when e.amount_low is not null then
      case
        when e.three_supplied then 'lowest_of_3'
        when e.amount_low < r.amount then 'lowest_so_far'
        else 'schedule'
      end
  end as forecast_basis,
  e.card_balance_owed
from public.recurring_transactions r
left join public.categories c on c.id = r.categoryid
left join public.v_account_balances cb on cb.account_id = r.to_accountid
cross join lateral (
  select
    case
      when not r.amount_is_variable then r.amount
      when r.to_accountid is not null and r.next_amount_confirmed_at is not null then r.next_amount
      when r.to_accountid is not null then greatest(-cb.balance, 0::numeric)::numeric(12,2)
      when c.category_type = 'Expense' then public.estimate_expense_amount(r.id, r.amount)
      else public.estimate_income_amount(r.id, r.amount)
    end as amount,
    case
      when r.amount_is_variable and r.to_accountid is null and c.category_type = 'Income'
        then public.estimate_income_amount_low(r.id, r.amount)
    end as amount_low,
    case
      when r.amount_is_variable and r.to_accountid is null and c.category_type = 'Expense'
        then public.estimate_expense_amount_high(r.id, r.amount)
    end as amount_high,
    case
      when r.amount_is_variable and r.to_accountid is not null
        then greatest(-cb.balance, 0::numeric)::numeric(12,2)
    end as card_balance_owed,
    r.amount_is_variable and r.to_accountid is null
      and public.has_three_supplied_amounts(r.id, c.category_type) as three_supplied
) e;

comment on view public.v_recurring_amounts is
  'Every schedule''s upcoming amounts and what each rests on -- paused ones included. The one place they are decided: v_upcoming_recurring and the recurring page both read it. amount is shown and written by a one-tap confirm; amount_high/amount_low are what the projection counts (migration 58). amount_basis/forecast_basis are labelled by lib/amountBasis.ts (migration 59).';

-- ---------------------------------------------------------------------
-- 4. v_upcoming_recurring (migration 59, unchanged)
-- ---------------------------------------------------------------------

create view public.v_upcoming_recurring with (security_invoker = true) as
 select r.id as recurring_id,
    r.userid,
    r.description,
    ra.amount,
    r.frequency,
    r.next_run_date,
    r.start_date,
    r.end_date,
    r.accountid,
    a.account_name,
    a.color as account_color,
    r.categoryid,
    c.category_name,
    c.icon as category_icon,
    c.color as category_color,
    (r.next_due_date - current_date) as days_until,
    (r.next_due_date < current_date) as is_overdue,
    r.interval_count,
    r.occurrence_limit,
    r.to_accountid,
    ta.account_name as to_account_name,
    c.category_type,
    r.amount_is_variable,
    r.statement_day,
    r.next_amount,
    r.next_amount_confirmed_at,
    (r.amount_is_variable and ((r.to_accountid is null) or (r.next_amount_confirmed_at is null))) as is_estimated_amount,
    r.next_due_date,
    a.account_type,
    ta.account_type as to_account_type,
    r.date_tolerance_days,
    r.requires_confirmation,
    ra.amount_low,
    r.business_day_offset,
    r.non_business_day_rule,
        case
            when (r.occurrence_limit is not null) then (r.occurrence_limit - occ.n)
            else null::bigint
        end as occurrences_remaining,
    ra.card_balance_owed,
    ra.amount_high,
    ra.amount_basis,
    ra.forecast_basis
   from public.recurring_transactions r
     join public.accounts a on a.id = r.accountid
     join public.v_recurring_amounts ra on ra.recurring_id = r.id
     left join public.categories c on c.id = r.categoryid
     left join public.accounts ta on ta.id = r.to_accountid
     -- One per occurrence: a transfer's two legs share transfer_group_id.
     cross join lateral (
       select count(distinct coalesce(t.transfer_group_id, t.id)) as n
       from public.transactions t
       where t.recurringid = r.id
     ) occ
  where r.is_active
    and (r.end_date is null or r.end_date >= current_date)
    and (r.occurrence_limit is null or occ.n < r.occurrence_limit);

comment on column public.v_upcoming_recurring.amount_high is
  'High estimate for a variable-amount Expense schedule (estimate_expense_amount_high); null for everything else. Read only by the safe-to-spend projection -- `amount` (the mean) is what is shown and what a one-tap confirm writes. The mirror of amount_low (migration 58).';
comment on column public.v_upcoming_recurring.occurrences_remaining is
  'occurrence_limit minus occurrences already confirmed -- counted as occurrences (a transfer''s two legs are one), not rows (migration 59).';
comment on column public.v_upcoming_recurring.amount_basis is
  'What `amount` rests on (v_recurring_amounts, migration 59).';
comment on column public.v_upcoming_recurring.forecast_basis is
  'What amount_high/amount_low rests on; null when there is neither (v_recurring_amounts, migration 59).';

-- ---------------------------------------------------------------------
-- 5. v_integrity_issues (baseline, unchanged)
-- ---------------------------------------------------------------------

CREATE VIEW public.v_integrity_issues WITH (security_invoker='true') AS
 SELECT 'contribution_amount_mismatch'::text AS issue_type,
    'medium'::text AS severity,
    'goal_contributions'::text AS table_name,
    gc.id AS record_id,
    t.userid,
    format('contribution %s vs transaction %s'::text, gc.amount, t.amount) AS detail
   FROM (public.goal_contributions gc
     JOIN public.transactions t ON ((t.id = gc.transactionid)))
  WHERE (gc.amount IS DISTINCT FROM t.amount)
UNION ALL
 SELECT 'missing_price'::text AS issue_type,
    'low'::text AS severity,
    'investments'::text AS table_name,
    i.investment_id AS record_id,
    i.userid,
    format('%s (%s): %s shares held, no current_price'::text, i.ticker, i.asset_type, i.shares) AS detail
   FROM public.v_investment_holdings i
  WHERE (i.price_is_stale AND i.is_open)
UNION ALL
 SELECT 'recurring_overdue'::text AS issue_type,
    'medium'::text AS severity,
    'recurring_transactions'::text AS table_name,
    r.recurring_id AS record_id,
    r.userid,
    format('%s was due %s (%s days ago)'::text, r.description, r.next_run_date, abs(r.days_until)) AS detail
   FROM public.v_upcoming_recurring r
  WHERE r.is_overdue
UNION ALL
 SELECT 'transfer_leg_mismatch'::text AS issue_type,
    'high'::text AS severity,
    'transactions'::text AS table_name,
    tg.transfer_group_id AS record_id,
    tg.userid,
    format('transfer_group %s: %s leg(s), %s distinct amount(s), %s distinct type(s)'::text, tg.transfer_group_id, tg.leg_count, tg.distinct_amounts, tg.distinct_types) AS detail
   FROM ( SELECT transactions.transfer_group_id,
            transactions.userid,
            count(*) AS leg_count,
            count(DISTINCT transactions.amount) AS distinct_amounts,
            count(DISTINCT transactions.transaction_type) AS distinct_types
           FROM public.transactions
          WHERE (transactions.transfer_group_id IS NOT NULL)
          GROUP BY transactions.transfer_group_id, transactions.userid) tg
  WHERE ((tg.leg_count <> 2) OR (tg.distinct_amounts <> 1) OR (tg.distinct_types <> 2))
UNION ALL
 SELECT 'recurring_due_date_stale'::text AS issue_type,
    'low'::text AS severity,
    'recurring_transactions'::text AS table_name,
    r.id AS record_id,
    r.userid,
    format('stored next_due_date %s, recomputed %s'::text, r.next_due_date, public.resolve_recurring_due_date(r.next_run_date, (r.business_day_offset)::integer, r.non_business_day_rule)) AS detail
   FROM public.recurring_transactions r
  WHERE (r.is_active AND (r.next_due_date IS DISTINCT FROM public.resolve_recurring_due_date(r.next_run_date, (r.business_day_offset)::integer, r.non_business_day_rule)));

-- ---------------------------------------------------------------------
-- 6. ACLs, explicitly: production's, as the baseline records them.
--    Revoke everything first, so neither project's default privileges
--    decide what the new views carry.
-- ---------------------------------------------------------------------

revoke all on public.v_recurring_amounts, public.v_upcoming_recurring, public.v_integrity_issues
  from public, anon, authenticated, service_role;

grant select, references, trigger, truncate, maintain
  on public.v_recurring_amounts, public.v_upcoming_recurring, public.v_integrity_issues
  to authenticated;
grant references, trigger, truncate, maintain
  on public.v_recurring_amounts, public.v_upcoming_recurring, public.v_integrity_issues
  to service_role;
