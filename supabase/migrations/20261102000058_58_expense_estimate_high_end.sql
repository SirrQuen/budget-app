-- =====================================================================
-- Sorrel 58: variable obligations forecast at their recent high, and
-- estimates read only amounts a person supplied
--
-- docs/Recurring-Amounts-and-Transfer-Editing.md, item 1b. Three parts.
--
-- 1. The forecast counted a variable expense at the MEAN of its last
--    three; income already counts at its minimum. CLAUDE.md "Uncertainty
--    always pushes the forecast down": an obligation counts at its HIGH
--    amount. A bill that has been $120, $190 and $142 was forecast at
--    $151 -- optimistic by $39, the dangerous direction.
--
--    The fix mirrors income exactly. Income has two figures: `amount`
--    (the mean -- shown, and written by a one-tap confirm) and
--    `amount_low` (the min -- read only by the projection). Expense now
--    gets the same split: new estimate_expense_amount_high and a new
--    v_upcoming_recurring.amount_high, read only by the projection
--    (lib/safeToSpendProjection.ts). `amount` stays the mean, so the
--    queue still says what the bill will probably be, and a one-tap
--    confirm never writes the peak into the ledger.
--
-- 2. is_estimated gets a meaning and every estimate honours it:
--
--      is_estimated is TRUE when the amount was never supplied by a
--      person, FALSE when it was.
--
--    The removed catch-up (generateDueOccurrences, gone 2026-10-17)
--    posted variable expenses at the estimate with is_estimated = true;
--    those rows were being averaged into the forecast as if real. From
--    this branch a one-tap "It landed" on a variable schedule writes
--    true too (lib/db/recurring.ts, confirmOccurrence) -- it confirms the
--    event, not the amount. All four estimates now skip those rows, so an
--    estimate is never built from an earlier estimate. A user who only
--    ever taps builds no history and keeps the schedule's own amount;
--    averaging averages would be circular.
--
-- 3. Changing a row's amount makes it a person's figure. The new trigger
--    trg_transactions_amount_supplied clears is_estimated whenever the
--    amount changes, on every write path -- an edit that touches only the
--    description or the date leaves an estimated row estimated.
--    (updateTransactionAction used to clear it on any save.)
--
-- v_upcoming_recurring is replaced with one column appended (amount_high);
-- every existing column keeps its name, type and position, so views built
-- on it (held migration 57's v_goal_monthly_holds) are unaffected.
--
-- THIS MOVES THE HERO NUMBER: a variable expense whose recent amounts
-- vary now counts at the highest of them, so safe to spend goes down for
-- anyone with one.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The estimates
-- ---------------------------------------------------------------------

create or replace function public.estimate_expense_amount(p_recurring_id uuid, p_fallback_amount numeric)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    (
      select round(avg(t.amount), 2)
      from (
        select amount
        from transactions
        where recurringid = p_recurring_id
          and transaction_type = 'Expense'
          and not is_estimated
        order by transaction_date desc, created_at desc
        limit 3
      ) t
      having count(*) >= 3
    ),
    p_fallback_amount
  );
$$;

comment on function public.estimate_expense_amount(uuid, numeric) is
  'Mean of the last three Expense transactions a person supplied the amount for (is_estimated = false), linked by recurringid; falls back to p_fallback_amount (the schedule''s stored amount) with fewer than three. The figure SHOWN for a variable Expense schedule and written by a one-tap confirm; the projection counts estimate_expense_amount_high instead (migration 58).';

create function public.estimate_expense_amount_high(p_recurring_id uuid, p_fallback_amount numeric)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select case
    when count(*) >= 3 then max(t.amount)
    else greatest(p_fallback_amount, coalesce(max(t.amount), p_fallback_amount))
  end
  from (
    select amount
    from transactions
    where recurringid = p_recurring_id
      and transaction_type = 'Expense'
      and not is_estimated
    order by transaction_date desc, created_at desc
    limit 3
  ) t;
$$;

comment on function public.estimate_expense_amount_high(uuid, numeric) is
  'High estimate for a variable-amount Expense schedule: max of the last three Expense transactions a person supplied the amount for (is_estimated = false), linked by recurringid, or greatest(stated amount, anything supplied) with fewer than three. Read only by the safe-to-spend projection (v_upcoming_recurring.amount_high), which counts an obligation at its high end. The mirror of estimate_income_amount_low (migration 58).';

revoke all on function public.estimate_expense_amount_high(uuid, numeric) from public;
grant all on function public.estimate_expense_amount_high(uuid, numeric) to authenticated;

create or replace function public.estimate_income_amount(p_recurring_id uuid, p_fallback_amount numeric)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    (
      select round(avg(t.amount), 2)
      from (
        select amount
        from transactions
        where recurringid = p_recurring_id
          and transaction_type = 'Income'
          and not is_estimated
        order by transaction_date desc, created_at desc
        limit 3
      ) t
      having count(*) >= 3
    ),
    p_fallback_amount
  );
$$;

comment on function public.estimate_income_amount(uuid, numeric) is
  'Mean of the last three Income transactions a person supplied the amount for (is_estimated = false), linked by recurringid; falls back to p_fallback_amount (the schedule''s stored amount) with fewer than three. The figure SHOWN for a variable Income schedule and written by a one-tap confirm; the projection counts estimate_income_amount_low instead (migration 58).';

create or replace function public.estimate_income_amount_low(p_recurring_id uuid, p_fallback_amount numeric)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select case
    when count(*) >= 3 then min(t.amount)
    else least(p_fallback_amount, coalesce(min(t.amount), p_fallback_amount))
  end
  from (
    select amount
    from transactions
    where recurringid = p_recurring_id
      and transaction_type = 'Income'
      and not is_estimated
    order by transaction_date desc, created_at desc
    limit 3
  ) t;
$$;

comment on function public.estimate_income_amount_low(uuid, numeric) is
  'Low estimate for a variable-amount Income schedule: min of the last three Income transactions a person supplied the amount for (is_estimated = false), linked by recurringid, or least(stated amount, anything supplied) with fewer than three. Read only by the safe-to-spend projection, which counts income at its low end. Mirrored by estimate_expense_amount_high (migration 58).';

-- ---------------------------------------------------------------------
-- 2. v_upcoming_recurring: amount_high appended
-- ---------------------------------------------------------------------

create or replace view public.v_upcoming_recurring with (security_invoker = true) as
 select r.id as recurring_id,
    r.userid,
    r.description,
        case
            when (not r.amount_is_variable) then r.amount
            when ((r.to_accountid is not null) and (r.next_amount_confirmed_at is not null)) then r.next_amount
            when (r.to_accountid is not null) then greatest((- cb.balance), (0)::numeric)
            when (c.category_type = 'Expense'::text) then public.estimate_expense_amount(r.id, r.amount)
            else public.estimate_income_amount(r.id, r.amount)
        end as amount,
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
        case
            when (r.amount_is_variable and (r.to_accountid is null) and (c.category_type = 'Income'::text)) then public.estimate_income_amount_low(r.id, r.amount)
            else null::numeric
        end as amount_low,
    r.business_day_offset,
    r.non_business_day_rule,
        case
            when (r.occurrence_limit is not null) then (r.occurrence_limit - ( select count(*) as count
               from public.transactions t
              where (t.recurringid = r.id)))
            else null::bigint
        end as occurrences_remaining,
        case
            when (r.amount_is_variable and (r.to_accountid is not null)) then greatest((- cb.balance), (0)::numeric)
            else null::numeric
        end as card_balance_owed,
        case
            when (r.amount_is_variable and (r.to_accountid is null) and (c.category_type = 'Expense'::text)) then public.estimate_expense_amount_high(r.id, r.amount)
            else null::numeric
        end as amount_high
   from ((((public.recurring_transactions r
     join public.accounts a on ((a.id = r.accountid)))
     left join public.categories c on ((c.id = r.categoryid)))
     left join public.accounts ta on ((ta.id = r.to_accountid)))
     left join public.v_account_balances cb on ((cb.account_id = r.to_accountid)))
  where (r.is_active and ((r.end_date is null) or (r.end_date >= current_date)) and ((r.occurrence_limit is null) or (( select count(*) as count
           from public.transactions t
          where (t.recurringid = r.id)) < r.occurrence_limit)));

comment on column public.v_upcoming_recurring.amount_high is
  'High estimate for a variable-amount Expense schedule (estimate_expense_amount_high); null for everything else. Read only by the safe-to-spend projection -- `amount` (the mean) is what is shown and what a one-tap confirm writes. The mirror of amount_low (migration 58).';

-- ---------------------------------------------------------------------
-- 3. is_estimated: a changed amount is a person's amount
-- ---------------------------------------------------------------------

create function public.clear_estimate_on_amount_change()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.amount is distinct from old.amount then
    new.is_estimated := false;
  end if;
  return new;
end;
$$;

comment on function public.clear_estimate_on_amount_change() is
  'BEFORE UPDATE OF amount on transactions: a row whose amount changes now holds a figure a person supplied, so is_estimated becomes false. On every write path, so no caller has to remember it (migration 58).';

revoke all on function public.clear_estimate_on_amount_change() from public;

create trigger trg_transactions_amount_supplied
  before update of amount on public.transactions
  for each row execute function public.clear_estimate_on_amount_change();

comment on column public.transactions.is_estimated is
  'TRUE when the amount was never supplied by a person, FALSE when it was (migration 58). True for a one-tap "It landed" on a variable-amount schedule (it confirms the event, not the amount) and for rows the removed catch-up posted before 2026-10-17. False for a fixed schedule''s one-tap confirm (the schedule''s stated amount), a card payment at a statement amount the user entered, an amount the user changed in "It was different" (saved unchanged it stays true), and anything entered by hand. Changing a row''s amount clears it (trg_transactions_amount_supplied). The recurring estimates skip true rows, so an estimate is never built from an estimate. The transaction list marks these rows approximate.';
