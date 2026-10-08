-- =====================================================================
-- EverNest 30: date_tolerance_days is NOT NULL, not nullable
--
-- Found immediately after 29_recurring_income_confirmation.sql shipped:
-- date_tolerance_days already existed on the live database -- smallint,
-- not null, default 0 -- before that migration ran, out of band, in no
-- migration file in this repo (same situation
-- 20_drop_stray_recurrence_index.sql documents for a different object).
-- "add column if not exists" is a no-op against an already-existing
-- column, so 29's intended nullable/no-default shape never actually took
-- effect -- every row already reads 0, never null.
--
-- On reflection this is the better shape anyway: "date varies, by 0 days"
-- and "date doesn't vary" behave identically (isAwaitingIncomeConfirmation
-- and paydayWindowEnd both no-op at tolerance 0 -- see
-- lib/recurringSchedule.ts), so there was never a real third state for
-- null to encode. This migration makes that the documented contract
-- instead of an accident: NOT NULL DEFAULT 0, no nullable branch anywhere
-- that reads it.
-- =====================================================================

update recurring_transactions set date_tolerance_days = 0 where date_tolerance_days is null;

alter table recurring_transactions
  alter column date_tolerance_days set default 0;

alter table recurring_transactions
  alter column date_tolerance_days set not null;

alter table recurring_transactions drop constraint if exists rectx_date_tolerance_range;
alter table recurring_transactions add  constraint rectx_date_tolerance_range
  check (date_tolerance_days between 0 and 14) not valid;
alter table recurring_transactions validate constraint rectx_date_tolerance_range;

-- enforce_recurring_variability_scope (29_recurring_income_confirmation.sql):
-- date_tolerance_days is never null now, so "varies" is
-- date_tolerance_days > 0, not "is not null".
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
    -- be null, wrongly failing an Income-only check below otherwise).
    if new.amount_is_variable and new.to_accountid is null and v_type is distinct from 'Income' then
      raise exception
        '"Amount changes each time" is only available for a transfer or an Income schedule (category %)',
        new.categoryid
        using errcode = '23514';
    end if;

    if new.date_tolerance_days > 0 and v_type is distinct from 'Income' then
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
