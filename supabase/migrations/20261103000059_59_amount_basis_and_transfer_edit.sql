-- =====================================================================
-- Sorrel 59: every upcoming amount says what it rests on; a transfer is
-- edited as one thing; transfer schedules count occurrences, not legs
--
-- docs/Recurring-Amounts-and-Transfer-Editing.md, items 1a and 4, plus the
-- occurrence-limit bug found in its Phase 1 report.
--
-- 1. v_recurring_amounts (new): the amounts and their provenance for EVERY
--    schedule, paused ones included. The one place an upcoming amount and
--    its label are decided. v_upcoming_recurring reads it (and keeps every
--    column it had, in the same positions -- CREATE OR REPLACE VIEW refuses
--    anything else -- appending two); the recurring page reads it
--    directly, replacing a per-row .rpc() loop and a TypeScript copy of the
--    card-balance rule.
--
--      amount_basis    what `amount` (shown, written by a one-tap confirm)
--                      rests on: fixed | statement | card_balance |
--                      average_of_3 | schedule
--      forecast_basis  what the cautious twin the projection counts rests
--                      on, null when there is none: highest_of_3 |
--                      highest_so_far | lowest_of_3 | lowest_so_far |
--                      schedule
--
--    "schedule" is the schedule's own amount -- a variable schedule with
--    fewer than three amounts a person supplied (migration 58). The labels
--    are lib/amountBasis.ts.
--
-- 2. Occurrence limits count OCCURRENCES. A confirmed transfer writes two
--    legs with the schedule's recurringid, and the view counted rows, so a
--    transfer schedule limited to 3 ended after 2 and the projection lost
--    its last occurrence. One production schedule had this on 2026-11-02
--    (limit 3, one confirmed, counted as two). Now count(distinct
--    coalesce(transfer_group_id, id)).
--
-- 3. update_transfer(): the ONLY write path for an existing transfer. Both
--    legs in one function call -- one transaction -- so they can't
--    disagree. SECURITY DEFINER scoped to auth.uid(), search_path pinned,
--    the shape of delete_own_account(). From, to, amount, date,
--    description and notes; swapping from and to swaps direction (the legs
--    keep their types, so the Expense leg is always the source). Optionally
--    updates the schedule's amount too ("this and future occurrences").
--
-- 4. trg_transactions_transfer_pair: any other UPDATE of a transfer leg
--    is refused, so the pairing is enforced by the database, not by
--    whichever caller remembers. update_transfer() opens the gate with a
--    transaction-local setting. A one-off service-role fix must do the
--    same: set_config('sorrel.transfer_edit', 'on', true).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Amounts and their provenance
-- ---------------------------------------------------------------------

create function public.has_three_supplied_amounts(p_recurring_id uuid, p_type text)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select count(*) >= 3
  from (
    select 1
    from transactions
    where recurringid = p_recurring_id
      and transaction_type = p_type
      and not is_estimated
    limit 3
  ) t;
$$;

comment on function public.has_three_supplied_amounts(uuid, text) is
  'True once a schedule has three transactions of p_type whose amount a person supplied (is_estimated = false) -- the point at which the estimates (migration 58) stop falling back to the schedule''s own amount. Decides amount_basis/forecast_basis in v_recurring_amounts (migration 59).';

revoke all on function public.has_three_supplied_amounts(uuid, text) from public;
grant execute on function public.has_three_supplied_amounts(uuid, text) to authenticated;

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
      when r.to_accountid is not null then greatest(-cb.balance, 0::numeric)
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
        then greatest(-cb.balance, 0::numeric)
    end as card_balance_owed,
    r.amount_is_variable and r.to_accountid is null
      and public.has_three_supplied_amounts(r.id, c.category_type) as three_supplied
) e;

comment on view public.v_recurring_amounts is
  'Every schedule''s upcoming amounts and what each rests on -- paused ones included. The one place they are decided: v_upcoming_recurring and the recurring page both read it. amount is shown and written by a one-tap confirm; amount_high/amount_low are what the projection counts (migration 58). amount_basis/forecast_basis are labelled by lib/amountBasis.ts (migration 59).';

revoke all on public.v_recurring_amounts from public, anon;
grant select on public.v_recurring_amounts to authenticated;

-- ---------------------------------------------------------------------
-- 2. v_upcoming_recurring: reads v_recurring_amounts; occurrences, not legs
-- ---------------------------------------------------------------------

create or replace view public.v_upcoming_recurring with (security_invoker = true) as
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

comment on column public.v_upcoming_recurring.occurrences_remaining is
  'occurrence_limit minus occurrences already confirmed -- counted as occurrences (a transfer''s two legs are one), not rows (migration 59).';
comment on column public.v_upcoming_recurring.amount_basis is
  'What `amount` rests on (v_recurring_amounts, migration 59).';
comment on column public.v_upcoming_recurring.forecast_basis is
  'What amount_high/amount_low rests on; null when there is neither (v_recurring_amounts, migration 59).';

-- ---------------------------------------------------------------------
-- 3. The transfer pair is enforced by the database
-- ---------------------------------------------------------------------

create function public.enforce_transfer_pair()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if (old.transfer_group_id is not null or new.transfer_group_id is not null)
     and coalesce(current_setting('sorrel.transfer_edit', true), '') <> 'on' then
    raise exception 'A transfer is edited as a pair, through update_transfer()'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.enforce_transfer_pair() is
  'BEFORE UPDATE on transactions: refuses any update to a transfer leg (or one that would make a row a leg) unless update_transfer() opened the gate (sorrel.transfer_edit = on, transaction-local). Editing one leg desyncs the pair -- money that doesn''t net to zero (migration 59).';

revoke all on function public.enforce_transfer_pair() from public;

create trigger trg_transactions_transfer_pair
  before update on public.transactions
  for each row execute function public.enforce_transfer_pair();

-- ---------------------------------------------------------------------
-- 4. update_transfer(): the only write path for an existing transfer
-- ---------------------------------------------------------------------

create function public.update_transfer(
  p_transfer_group_id uuid,
  p_from_accountid    uuid,
  p_to_accountid      uuid,
  p_amount            numeric,
  p_transaction_date  date,
  p_description       text,
  p_notes             text default null,
  p_update_schedule   boolean default false
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_legs        int;
  v_recurringid uuid;
begin
  if v_uid is null then
    raise exception 'update_transfer: no authenticated user';
  end if;
  if p_from_accountid is null or p_to_accountid is null or p_from_accountid = p_to_accountid then
    raise exception 'Choose two different accounts for a transfer.' using errcode = '23514';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = '23514';
  end if;
  if p_transaction_date is null or coalesce(btrim(p_description), '') = '' then
    raise exception 'A transfer needs a date and a description.' using errcode = '23514';
  end if;

  -- Both accounts are the caller's. Another user's account looks the same
  -- as a missing one.
  if (select count(*) from public.accounts
       where id in (p_from_accountid, p_to_accountid) and userid = v_uid) <> 2 then
    raise exception 'update_transfer: account not found' using errcode = 'P0002';
  end if;

  -- Exactly the caller's pair: one Expense leg, one Income leg.
  select count(*), max(recurringid::text)::uuid
    into v_legs, v_recurringid
    from public.transactions
   where transfer_group_id = p_transfer_group_id and userid = v_uid;
  if v_legs <> 2
     or (select count(distinct transaction_type) from public.transactions
          where transfer_group_id = p_transfer_group_id and userid = v_uid) <> 2 then
    raise exception 'update_transfer: transfer not found' using errcode = 'P0002';
  end if;

  perform set_config('sorrel.transfer_edit', 'on', true);

  -- The Expense leg is the source and the Income leg the destination, so
  -- swapping the accounts swaps the direction and the pair stays correct.
  update public.transactions
     set accountid = case transaction_type when 'Expense' then p_from_accountid else p_to_accountid end,
         amount = p_amount,
         transaction_date = p_transaction_date,
         description = btrim(p_description),
         notes = nullif(btrim(coalesce(p_notes, '')), '')
   where transfer_group_id = p_transfer_group_id and userid = v_uid;

  -- "This and future occurrences": the schedule expects the new amount.
  if p_update_schedule and v_recurringid is not null then
    update public.recurring_transactions
       set amount = p_amount
     where id = v_recurringid and userid = v_uid;
  end if;

  perform set_config('sorrel.transfer_edit', '', true);
end;
$$;

comment on function public.update_transfer(uuid, uuid, uuid, numeric, date, text, text, boolean) is
  'The only write path for an existing transfer: both legs in one call, so they can''t disagree. From/to/amount/date/description/notes; swapping from and to swaps direction. p_update_schedule also sets the schedule''s amount ("this and future occurrences"). SECURITY DEFINER, scoped to auth.uid() (migration 59).';

revoke all on function public.update_transfer(uuid, uuid, uuid, numeric, date, text, text, boolean) from public, anon;
grant execute on function public.update_transfer(uuid, uuid, uuid, numeric, date, text, text, boolean) to authenticated;
