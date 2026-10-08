-- =====================================================================
-- EverNest 29: Variable-amount / variable-date Income + mandatory
-- confirmation, reusing the item 1 (23_recurring_variable_amount)
-- machinery.
--
-- Phase 6.75 item 6. CLAUDE.md's new money rule: "Auto-create outflows.
-- Confirm inflows." -- assuming money left when it didn't makes a user
-- cautious (recoverable); assuming money arrived when it didn't makes them
-- overspend (not recoverable the same way). So:
--
--   amount_is_variable   now ALSO legal on a category schedule, when that
--                         category is Income -- "amount changes each
--                         time" (a paycheck with variable hours). Its
--                         estimate is the mean of the last three confirmed
--                         Income transactions linked by recurringid (see
--                         estimate_income_amount below), not a live
--                         balance the way a card payment's is.
--   date_tolerance_days   0-14, nullable. Non-null means "date varies" --
--                         independent of amount_is_variable (a schedule
--                         can have a fixed amount and a variable date, or
--                         the reverse). Read in OPPOSITE directions by its
--                         two consumers -- see lib/recurringSchedule.ts's
--                         incomeConfirmationOpensAt/paydayWindowEnd, never
--                         computed live in SQL (date-window logic is
--                         TS-authoritative in this codebase, same as
--                         lib/businessDays.ts).
--   requires_confirmation True for every Income schedule, existing and
--                         new, regardless of amount_is_variable/
--                         date_tolerance_days -- generateDueOccurrences
--                         (lib/db/recurring.ts) now refuses to post an
--                         Income occurrence unless this is false OR a
--                         confirmed amount is already on file (never true
--                         for Income by construction -- see
--                         confirmIncomeOccurrence, which writes the
--                         transaction directly instead of leaving a
--                         pending next_amount the way a card payment
--                         does). Outflows (Expense, and every Transfer
--                         including a variable card payment) are
--                         untouched -- they keep auto-generating per
--                         Phase 6.5/item 1.
--
-- A CHECK constraint can't reference categories.category_type (another
-- table) -- same reasoning as enforce_category_type
-- (04_hardening.sql STEP 4b). rectx_variable_requires_transfer is
-- superseded by a trigger below that allows amount_is_variable/
-- date_tolerance_days/requires_confirmation for a transfer template OR an
-- Income category schedule (never a bare Expense one).
-- =====================================================================

alter table recurring_transactions
  add column if not exists date_tolerance_days integer;

alter table recurring_transactions
  add column if not exists requires_confirmation boolean not null default false;

alter table recurring_transactions drop constraint if exists rectx_date_tolerance_range;
alter table recurring_transactions add  constraint rectx_date_tolerance_range
  check (date_tolerance_days is null or date_tolerance_days between 0 and 14) not valid;
alter table recurring_transactions validate constraint rectx_date_tolerance_range;

-- statement_day is a Credit-Card-payment concept only -- an Income
-- schedule's variable amount has no statement day at all, so this now
-- only fires for a transfer template (to_accountid not null), same as
-- before this migration for every existing card-payment row.
alter table recurring_transactions drop constraint if exists rectx_variable_requires_statement_day;
alter table recurring_transactions add  constraint rectx_variable_requires_statement_day
  check (not amount_is_variable or to_accountid is null or statement_day is not null) not valid;
alter table recurring_transactions validate constraint rectx_variable_requires_statement_day;

alter table recurring_transactions drop constraint if exists rectx_variable_requires_transfer;

create or replace function public.enforce_recurring_variability_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_type text;
begin
  if new.amount_is_variable or new.date_tolerance_days is not null or new.requires_confirmation then
    select category_type into v_type
      from public.categories where id = new.categoryid;

    -- Only checked when NOT a transfer -- a transfer template's own
    -- rectx_variable_requires_statement_day/rectx_transfer_accounts_differ
    -- already cover it, and it has no categoryid to look up (v_type would
    -- be null, wrongly failing an Income-only check below otherwise).
    if new.amount_is_variable and new.to_accountid is null and v_type is distinct from 'Income' then
      raise exception
        '"Amount changes each time" is only available for a transfer or an Income schedule (category %)',
        new.categoryid
        using errcode = '23514';
    end if;

    if new.date_tolerance_days is not null and v_type is distinct from 'Income' then
      raise exception
        'A variable date is only available for an Income schedule (category %)',
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

-- Confirmation is now required for every Income schedule that already
-- existed before this migration too -- app code (lib/actions/recurring.ts)
-- forces requires_confirmation true for a new or edited Income schedule,
-- but this backfill is the only thing that reaches a schedule nobody
-- touches again. Safe to rerun: only flips rows that are still false.
update recurring_transactions r
  set requires_confirmation = true
  from categories c
  where c.id = r.categoryid
    and c.category_type = 'Income'
    and not r.requires_confirmation;

-- =====================================================================
-- estimate_income_amount(p_recurring_id, p_fallback_amount)
--
-- Mean of the last three confirmed Income transactions linked by
-- recurringid, falling back to p_fallback_amount (the schedule's own
-- `amount` column) with fewer than three -- exactly the CLAUDE.md rule
-- "never aggregate money in JavaScript. Use the v_* views, or sum ... in
-- SQL": this is the one canonical implementation, called both from
-- v_upcoming_recurring below (for every reader of that view -- dashboard,
-- safe-to-spend, the upcoming list) and directly via .rpc() from the
-- recurring list page, which reads the base table, not the view (same
-- reason lib/accountOptions.ts's estimateCardPaymentDue exists alongside
-- v_upcoming_recurring's own card-balance branch -- a paused schedule
-- still needs an estimate, and the view filters is_active).
--
-- security invoker: runs as the calling user, so RLS on transactions
-- scopes the read. STABLE, not IMMUTABLE: the answer changes as new
-- transactions post.
-- =====================================================================

create or replace function public.estimate_income_amount(p_recurring_id uuid, p_fallback_amount numeric)
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
        where recurringid = p_recurring_id and transaction_type = 'Income'
        order by transaction_date desc, created_at desc
        limit 3
      ) t
      having count(*) >= 3
    ),
    p_fallback_amount
  );
$$;

comment on function public.estimate_income_amount(uuid, numeric) is
  'Mean of the last three confirmed Income transactions linked by recurringid; falls back to p_fallback_amount (the schedule''s stored amount) with fewer than three. Always an estimate for a variable-amount Income schedule -- see CLAUDE.md "Display".';

revoke all on function public.estimate_income_amount(uuid, numeric) from public, anon;
grant execute on function public.estimate_income_amount(uuid, numeric) to authenticated;

-- =====================================================================
-- v_upcoming_recurring: the amount CASE no longer breaks for a variable
-- Income row (to_accountid null, so the old "else greatest(-cb.balance,
-- 0)" branch -- a card-balance expression -- evaluated to null for one).
-- New branch calls estimate_income_amount instead. is_estimated_amount
-- widens the same way: true whenever amount_is_variable and there's no
-- confirmed pending amount to show instead -- which for an Income row is
-- always (confirmIncomeOccurrence never leaves one on file, see
-- lib/db/recurring.ts), so a variable Income row is always marked an
-- estimate, per CLAUDE.md "Display". date_tolerance_days and
-- requires_confirmation are appended strictly after to_account_type, the
-- last column 27_safe_to_spend_to_account_type.sql added.
-- =====================================================================

create or replace view public.v_upcoming_recurring
with (security_invoker = true) as
select
  r.id as recurring_id, r.userid, r.description,
  case
    when not r.amount_is_variable then r.amount
    when r.to_accountid is not null and r.next_amount_confirmed_at is not null then r.next_amount
    when r.to_accountid is not null then greatest(-cb.balance, 0)
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
