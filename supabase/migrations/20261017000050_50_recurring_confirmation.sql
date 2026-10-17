-- =====================================================================
-- EverNest 50: recurring confirmation -- a schedule never writes a
-- transaction; only a person's confirmation does
--
-- The app no longer posts recurring occurrences by itself (the render-
-- time catch-up is gone; see docs/Recurring-Confirmation.md). Two schema
-- consequences, nothing else:
--
-- 1. date_tolerance_days ("Date varies") is allowed on a transfer. A
--    card payment is the case that needed it most: a statement doesn't
--    land on a fixed day. Tolerance keeps its existing projection meaning
--    (an outflow counts on its early edge) and also opens the
--    confirmation queue on that edge. Category schedules still need an
--    Income or Expense category, as before.
--
-- 2. transactions.is_estimated is deprecated. Only the removed catch-up
--    ever set it true. The column stays (no unrelated schema churn while
--    migration 48 settles); edits still clear it on legacy rows.
-- =====================================================================

create or replace function public.enforce_recurring_variability_scope()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare v_type text;
begin
  if new.amount_is_variable or new.date_tolerance_days > 0 or new.requires_confirmation then
    -- Scoped to the row's owner: another user's category must look the
    -- same as a nonexistent one (see migration 38).
    select category_type into v_type
      from public.categories
     where id = new.categoryid
       and userid = new.userid;

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

    -- Migration 50: a transfer may vary in date too.
    if new.date_tolerance_days > 0 and new.to_accountid is null
       and v_type is distinct from 'Income' and v_type is distinct from 'Expense' then
      raise exception
        'A variable date is only available for a transfer, an Income schedule, or an Expense schedule (category %)',
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
$$;

comment on column public.transactions.is_estimated is
  'DEPRECATED (migration 50). Was set true by the removed recurring catch-up when it posted a variable-amount Expense at its estimate. Nothing sets it true now: every recurring transaction is confirmed by the user at a real amount. Kept for legacy rows; updateTransactionAction clears it on edit.';
