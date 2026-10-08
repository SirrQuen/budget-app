-- =====================================================================
-- EverNest 38: Category triggers only see the row owner's categories
--
-- enforce_category_type() and enforce_recurring_variability_scope() are
-- SECURITY DEFINER BEFORE triggers that looked up categories by id alone.
-- BEFORE triggers run before RLS checks the new row, so for another
-- user's category they answered with that category's type:
--
--   B inserts an Expense with A's Income categoryid
--     -> "Category is Income but transaction is Expense"   (23514)
--   B inserts an Expense with a made-up categoryid
--     -> "new row violates row-level security policy"      (42501)
--
-- The difference tells B the id exists and what type it is. The
-- recurring trigger leaked the same way through requires_confirmation,
-- date_tolerance_days and amount_is_variable.
--
-- Both lookups now also require c.userid = new.userid. Another user's
-- category is then indistinguishable from a nonexistent one, and
-- migration 37's WITH CHECK rejects the row.
--
-- Unchanged: the type checks on a user's own categories, the error
-- messages and codes, SECURITY DEFINER and search_path. CREATE OR
-- REPLACE keeps the grants revoked in migration 36 and the existing
-- triggers.
--
-- Known limit, tracked with the composite-FK launch blocker in
-- docs/phase-7-findings.md: a write that bypasses RLS (service_role,
-- owner) with a cross-user categoryid now skips the type check instead
-- of applying it. Composite FKs make that row impossible.
--
-- docs/rls-isolation-test.sql section 7 asserts both the leak and the
-- triggers' own-category behaviour.
-- =====================================================================

create or replace function public.enforce_category_type()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare v_type text;
begin
  if new.categoryid is null then
    return new;
  end if;

  -- Scoped to the row's owner: another user's category must look the same
  -- as a nonexistent one (see migration 38).
  select category_type into v_type
    from public.categories
   where id = new.categoryid
     and userid = new.userid;

  if v_type is not null and v_type <> new.transaction_type then
    raise exception
      'Category is % but transaction is % (category %)',
      v_type, new.transaction_type, new.categoryid
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

create or replace function public.enforce_recurring_variability_scope()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
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
$function$;
