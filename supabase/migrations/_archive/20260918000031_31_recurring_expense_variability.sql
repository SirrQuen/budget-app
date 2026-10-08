-- =====================================================================
-- EverNest 31: Variable-amount / variable-date support for recurring
-- EXPENSE schedules (Phase 6.76), extending the item 1/item 6 machinery
-- 29_recurring_income_confirmation.sql gave Income.
--
-- Unlike Income, an Expense occurrence never requires confirmation --
-- CLAUDE.md "Auto-create outflows. Confirm inflows." -- so
-- requires_confirmation stays Income-only below, unchanged. A
-- variable-amount Expense instead auto-generates at a live estimate
-- (estimate_expense_amount, mirroring estimate_income_amount) with the
-- posted transaction marked is_estimated -- see lib/db/recurring.ts's
-- generateDueOccurrences. Card-payment transfers are untouched: they still
-- gate on a confirmed next_amount, never an estimate.
--
-- date_tolerance_days now also applies to an Expense schedule, but its
-- consumer is the OPPOSITE edge of Income's: lib/recurringSchedule.ts's
-- expenseCommitmentDate (anchor - tolerance) vs paydayWindowEnd
-- (anchor + tolerance). Still TS-authoritative, never computed in SQL --
-- same reasoning as the 29 migration's own comment.
-- =====================================================================

alter table transactions
  add column if not exists is_estimated boolean not null default false;

comment on column transactions.is_estimated is
  'True for a transaction generateDueOccurrences posted from a variable-amount Expense schedule''s live estimate (never Income or a card payment, which only ever post a confirmed amount) -- CLAUDE.md "Recurring transactions": auto-created outflows are visibly marked, freely editable, never gated on confirmation. Cleared back to false the moment a user edits the row (updateTransactionAction) -- an edited amount is a known figure, not a guess anymore.';

-- v_type now also accepts 'Expense' for amount_is_variable/date_tolerance_days
-- (never for requires_confirmation, which stays Income-only).
create or replace function public.enforce_recurring_variability_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_type text;
begin
  if new.amount_is_variable or new.date_tolerance_days > 0 or new.requires_confirmation then
    select category_type into v_type
      from public.categories where id = new.categoryid;

    -- Only checked when NOT a transfer -- a transfer template's own
    -- rectx_variable_requires_statement_day/rectx_transfer_accounts_differ
    -- already cover it, and it has no categoryid to look up (v_type would
    -- be null, wrongly failing the checks below otherwise).
    if new.amount_is_variable and new.to_accountid is null
       and v_type is distinct from 'Income' and v_type is distinct from 'Expense' then
      raise exception
        '"Amount changes each time" is only available for a transfer, an Income schedule, or an Expense schedule (category %)',
        new.categoryid
        using errcode = '23514';
    end if;

    if new.date_tolerance_days > 0
       and v_type is distinct from 'Income' and v_type is distinct from 'Expense' then
      raise exception
        'A variable date is only available for an Income or Expense schedule (category %)',
        new.categoryid
        using errcode = '23514';
    end if;

    if new.requires_confirmation and v_type is distinct from 'Income' then
      raise exception
        'Confirmation is only required for an Income schedule (category %)',
        new.categoryid
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_recurring_variability_scope on recurring_transactions;
create trigger trg_recurring_variability_scope
  before insert or update of amount_is_variable, date_tolerance_days, requires_confirmation, categoryid, to_accountid
  on recurring_transactions
  for each row execute function public.enforce_recurring_variability_scope();

-- =====================================================================
-- estimate_expense_amount(p_recurring_id, p_fallback_amount)
--
-- Mirrors estimate_income_amount exactly, filtered to transaction_type =
-- 'Expense' instead -- mean of the last three generated Expense
-- transactions linked by recurringid, falling back to p_fallback_amount
-- (the schedule's own `amount`) with fewer than three. Unlike Income's
-- version, this one is also called from generateDueOccurrences itself (an
-- Expense occurrence posts immediately at this estimate, no confirmation
-- step to defer to) as well as from v_upcoming_recurring below and the
-- recurring list page, for a paused schedule that view excludes.
-- =====================================================================

create or replace function public.estimate_expense_amount(p_recurring_id uuid, p_fallback_amount numeric)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (
      select round(avg(t.amount), 2)
      from (
        select amount
        from transactions
        where recurringid = p_recurring_id and transaction_type = 'Expense'
        order by transaction_date desc, created_at desc
        limit 3
      ) t
      having count(*) >= 3
    ),
    p_fallback_amount
  );
$$;

comment on function public.estimate_expense_amount(uuid, numeric) is
  'Mean of the last three generated Expense transactions linked by recurringid; falls back to p_fallback_amount (the schedule''s stored amount) with fewer than three. Always an estimate for a variable-amount Expense schedule -- see CLAUDE.md "Recurring transactions".';

revoke all on function public.estimate_expense_amount(uuid, numeric) from public, anon;
grant execute on function public.estimate_expense_amount(uuid, numeric) to authenticated;

-- =====================================================================
-- v_upcoming_recurring: the amount CASE's "else" branch used to assume any
-- amount_is_variable, non-transfer row was Income. Split it on
-- category_type now that an Expense category schedule can be variable too.
-- is_estimated_amount's formula is unchanged -- it already reads
-- "amount_is_variable and no confirmed pending amount", which for an
-- Expense row (no next_amount/confirmed_at path at all) is simply
-- "amount_is_variable", always true while it's on -- exactly the
-- CLAUDE.md "always mark an estimate" rule this schedule needs too.
-- =====================================================================

create or replace view public.v_upcoming_recurring
with (security_invoker = true) as
select
  r.id as recurring_id, r.userid, r.description,
  case
    when not r.amount_is_variable then r.amount
    when r.to_accountid is not null and r.next_amount_confirmed_at is not null then r.next_amount
    when r.to_accountid is not null then greatest(-cb.balance, 0)
    when c.category_type = 'Expense' then public.estimate_expense_amount(r.id, r.amount)
    else public.estimate_income_amount(r.id, r.amount)
  end as amount,
  r.frequency,
  r.next_run_date, r.start_date, r.end_date,
  r.accountid, a.account_name, a.color as account_color,
  r.categoryid, c.category_name, c.icon as category_icon, c.color as category_color,
  (r.next_due_date - current_date) as days_until,
  (r.next_due_date < current_date) as is_overdue,
  r.interval_count, r.occurrence_limit,
  r.to_accountid, ta.account_name as to_account_name,
  c.category_type,
  r.amount_is_variable, r.statement_day, r.next_amount, r.next_amount_confirmed_at,
  (r.amount_is_variable and (r.to_accountid is null or r.next_amount_confirmed_at is null)) as is_estimated_amount,
  r.next_due_date, a.account_type,
  ta.account_type as to_account_type,
  r.date_tolerance_days, r.requires_confirmation
from recurring_transactions r
join accounts a        on a.id  = r.accountid
left join categories c on c.id  = r.categoryid
left join accounts ta  on ta.id = r.to_accountid
left join public.v_account_balances cb on cb.account_id = r.to_accountid
where r.is_active
  and (r.end_date is null or r.end_date >= current_date)
  and (r.occurrence_limit is null
       or (select count(*) from transactions t where t.recurringid = r.id) < r.occurrence_limit);

grant select on public.v_upcoming_recurring to authenticated;
revoke all on public.v_upcoming_recurring from anon;
