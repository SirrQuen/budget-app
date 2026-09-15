-- =====================================================================
-- EverNest 25: Bank holiday calendar + business-day functions
--
-- bank_holidays is shared reference data, not user data -- no userid
-- column, RLS enabled with a single permissive SELECT policy for any
-- signed-in user (mirrors how CLAUDE.md treats a lookup/enum table, not
-- the per-row-ownership pattern every user table follows). Writes are
-- migration/service-role only, same posture as `subscriptions`.
--
-- Seeded with the 11 US federal holidays for 2026-2035 (ten calendar
-- years from today), weekend-observance already applied: a holiday that
-- falls on Saturday is observed the preceding Friday, one that falls on
-- Sunday the following Monday (OPM's standard rule). MLK/Presidents/
-- Memorial/Labor/Columbus/Thanksgiving are already defined as "Nth
-- weekday of the month" so they never need the shift; New Year's,
-- Juneteenth, Independence Day, Veterans Day and Christmas are fixed
-- dates and do. Values below were computed programmatically and checked
-- against the calendar (e.g. New Year's Day 2028 falls on a Saturday and
-- is correctly observed Friday 2027-12-31), then written as literals here
-- rather than as a runtime date-generation script -- a fixed holiday
-- table has no business being computed on every deploy.
--
-- Not skipping this (a plain weekday check alone) would predict a payday
-- landing on Thanksgiving or Christmas a day early -- see CLAUDE.md/the
-- task brief: that inflates the safe-to-spend hero on exactly the days a
-- user is most likely to be relying on it.
-- =====================================================================

create table if not exists bank_holidays (
  date  date primary key,
  label text not null
);

alter table bank_holidays enable row level security;

drop policy if exists "bank_holidays_select_authenticated" on bank_holidays;
create policy "bank_holidays_select_authenticated"
  on bank_holidays for select
  to authenticated
  using (true);

revoke all on bank_holidays from anon;
grant select on bank_holidays to authenticated;

insert into bank_holidays (date, label) values
  ('2026-01-01', 'New Year''s Day'),
  ('2026-01-19', 'Martin Luther King Jr. Day'),
  ('2026-02-16', 'Washington''s Birthday'),
  ('2026-05-25', 'Memorial Day'),
  ('2026-06-19', 'Juneteenth National Independence Day'),
  ('2026-07-03', 'Independence Day'),
  ('2026-09-07', 'Labor Day'),
  ('2026-10-12', 'Columbus Day'),
  ('2026-11-11', 'Veterans Day'),
  ('2026-11-26', 'Thanksgiving Day'),
  ('2026-12-25', 'Christmas Day'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-01-18', 'Martin Luther King Jr. Day'),
  ('2027-02-15', 'Washington''s Birthday'),
  ('2027-05-31', 'Memorial Day'),
  ('2027-06-18', 'Juneteenth National Independence Day'),
  ('2027-07-05', 'Independence Day'),
  ('2027-09-06', 'Labor Day'),
  ('2027-10-11', 'Columbus Day'),
  ('2027-11-11', 'Veterans Day'),
  ('2027-11-25', 'Thanksgiving Day'),
  ('2027-12-24', 'Christmas Day'),
  ('2027-12-31', 'New Year''s Day'),
  ('2028-01-17', 'Martin Luther King Jr. Day'),
  ('2028-02-21', 'Washington''s Birthday'),
  ('2028-05-29', 'Memorial Day'),
  ('2028-06-19', 'Juneteenth National Independence Day'),
  ('2028-07-04', 'Independence Day'),
  ('2028-09-04', 'Labor Day'),
  ('2028-10-09', 'Columbus Day'),
  ('2028-11-10', 'Veterans Day'),
  ('2028-11-23', 'Thanksgiving Day'),
  ('2028-12-25', 'Christmas Day'),
  ('2029-01-01', 'New Year''s Day'),
  ('2029-01-15', 'Martin Luther King Jr. Day'),
  ('2029-02-19', 'Washington''s Birthday'),
  ('2029-05-28', 'Memorial Day'),
  ('2029-06-19', 'Juneteenth National Independence Day'),
  ('2029-07-04', 'Independence Day'),
  ('2029-09-03', 'Labor Day'),
  ('2029-10-08', 'Columbus Day'),
  ('2029-11-12', 'Veterans Day'),
  ('2029-11-22', 'Thanksgiving Day'),
  ('2029-12-25', 'Christmas Day'),
  ('2030-01-01', 'New Year''s Day'),
  ('2030-01-21', 'Martin Luther King Jr. Day'),
  ('2030-02-18', 'Washington''s Birthday'),
  ('2030-05-27', 'Memorial Day'),
  ('2030-06-19', 'Juneteenth National Independence Day'),
  ('2030-07-04', 'Independence Day'),
  ('2030-09-02', 'Labor Day'),
  ('2030-10-14', 'Columbus Day'),
  ('2030-11-11', 'Veterans Day'),
  ('2030-11-28', 'Thanksgiving Day'),
  ('2030-12-25', 'Christmas Day'),
  ('2031-01-01', 'New Year''s Day'),
  ('2031-01-20', 'Martin Luther King Jr. Day'),
  ('2031-02-17', 'Washington''s Birthday'),
  ('2031-05-26', 'Memorial Day'),
  ('2031-06-19', 'Juneteenth National Independence Day'),
  ('2031-07-04', 'Independence Day'),
  ('2031-09-01', 'Labor Day'),
  ('2031-10-13', 'Columbus Day'),
  ('2031-11-11', 'Veterans Day'),
  ('2031-11-27', 'Thanksgiving Day'),
  ('2031-12-25', 'Christmas Day'),
  ('2032-01-01', 'New Year''s Day'),
  ('2032-01-19', 'Martin Luther King Jr. Day'),
  ('2032-02-16', 'Washington''s Birthday'),
  ('2032-05-31', 'Memorial Day'),
  ('2032-06-18', 'Juneteenth National Independence Day'),
  ('2032-07-05', 'Independence Day'),
  ('2032-09-06', 'Labor Day'),
  ('2032-10-11', 'Columbus Day'),
  ('2032-11-11', 'Veterans Day'),
  ('2032-11-25', 'Thanksgiving Day'),
  ('2032-12-24', 'Christmas Day'),
  ('2032-12-31', 'New Year''s Day'),
  ('2033-01-17', 'Martin Luther King Jr. Day'),
  ('2033-02-21', 'Washington''s Birthday'),
  ('2033-05-30', 'Memorial Day'),
  ('2033-06-20', 'Juneteenth National Independence Day'),
  ('2033-07-04', 'Independence Day'),
  ('2033-09-05', 'Labor Day'),
  ('2033-10-10', 'Columbus Day'),
  ('2033-11-11', 'Veterans Day'),
  ('2033-11-24', 'Thanksgiving Day'),
  ('2033-12-26', 'Christmas Day'),
  ('2034-01-02', 'New Year''s Day'),
  ('2034-01-16', 'Martin Luther King Jr. Day'),
  ('2034-02-20', 'Washington''s Birthday'),
  ('2034-05-29', 'Memorial Day'),
  ('2034-06-19', 'Juneteenth National Independence Day'),
  ('2034-07-04', 'Independence Day'),
  ('2034-09-04', 'Labor Day'),
  ('2034-10-09', 'Columbus Day'),
  ('2034-11-10', 'Veterans Day'),
  ('2034-11-23', 'Thanksgiving Day'),
  ('2034-12-25', 'Christmas Day'),
  ('2035-01-01', 'New Year''s Day'),
  ('2035-01-15', 'Martin Luther King Jr. Day'),
  ('2035-02-19', 'Washington''s Birthday'),
  ('2035-05-28', 'Memorial Day'),
  ('2035-06-19', 'Juneteenth National Independence Day'),
  ('2035-07-04', 'Independence Day'),
  ('2035-09-03', 'Labor Day'),
  ('2035-10-08', 'Columbus Day'),
  ('2035-11-12', 'Veterans Day'),
  ('2035-11-22', 'Thanksgiving Day'),
  ('2035-12-25', 'Christmas Day')
on conflict (date) do nothing;

-- =====================================================================
-- is_business_day / add_business_days
--
-- STABLE, not IMMUTABLE -- both read bank_holidays, so the result can
-- change if that table is ever edited, even though the inputs don't. The
-- weekend half of is_business_day (isodow < 6) would be honestly
-- IMMUTABLE on its own; composed with the holiday lookup it isn't, so the
-- function as a whole is declared for what it actually is.
--
-- These are NOT on the hot path for schedule resolution -- see
-- 24_recurring_business_day_rules.sql's comment: lib/businessDays.ts
-- (TypeScript) is the source of truth there, unit-tested with no
-- database. These two, plus resolve_recurring_due_date below, exist so
-- v_integrity_issues can independently recompute and catch a stored
-- next_due_date that's drifted from what the app should have written.
-- =====================================================================

create or replace function public.is_business_day(d date)
returns boolean
language sql
stable
as $$
  select extract(isodow from d) < 6
     and not exists (select 1 from public.bank_holidays h where h.date = d);
$$;

-- Counts forward N business days from anchor, anchor itself excluded from
-- the count (T+N convention -- add_business_days(fri, 1) with fri a
-- business day lands on the following Monday, not on fri itself). n = 0
-- is the identity; n < 0 is a caller error, not a "count backward" mode --
-- resolve_recurring_due_date below handles the backward-shift case
-- (non_business_day_rule = 'before') with its own explicit walk.
create or replace function public.add_business_days(anchor date, n integer)
returns date
language plpgsql
stable
as $$
declare
  result date := anchor;
  remaining integer := n;
begin
  if n < 0 then
    raise exception 'add_business_days: n must be >= 0, got %', n;
  end if;

  while remaining > 0 loop
    result := result + 1;
    if public.is_business_day(result) then
      remaining := remaining - 1;
    end if;
  end loop;

  return result;
end;
$$;

-- Mirrors lib/businessDays.ts's resolveDueDate exactly -- see that file's
-- comment for the full rationale. offset_days > 0 counts forward that many
-- business days (rule is irrelevant: the result is already a business
-- day). offset_days = 0 applies rule only when anchor itself isn't a
-- business day: 'before'/'after' walk to the nearest one in that
-- direction, 'none' leaves anchor untouched.
create or replace function public.resolve_recurring_due_date(
  anchor date,
  offset_days integer,
  rule text
)
returns date
language plpgsql
stable
as $$
declare
  d date := anchor;
begin
  if offset_days > 0 then
    return public.add_business_days(anchor, offset_days);
  end if;

  if public.is_business_day(anchor) then
    return anchor;
  end if;

  if rule = 'before' then
    while not public.is_business_day(d) loop
      d := d - 1;
    end loop;
  elsif rule = 'after' then
    while not public.is_business_day(d) loop
      d := d + 1;
    end loop;
  end if;
  -- rule = 'none' (or anything unrecognised): d stays anchor, unshifted.

  return d;
end;
$$;

grant execute on function public.is_business_day(date) to authenticated;
grant execute on function public.add_business_days(date, integer) to authenticated;
grant execute on function public.resolve_recurring_due_date(date, integer, text) to authenticated;

-- =====================================================================
-- v_upcoming_recurring: append next_due_date (the resolved date -- see
-- 24_recurring_business_day_rules.sql) and account_type (needed by
-- getSafeToSpend to find an Income schedule landing in a Checking/Savings
-- account). days_until/is_overdue now compute off next_due_date instead
-- of next_run_date -- same names and types, which CREATE OR REPLACE
-- allows (migrations 18/21/23 already lean on this). New columns
-- appended strictly after is_estimated_amount, the last column
-- 23_recurring_variable_amount.sql added -- Postgres refuses to reorder
-- an existing view's columns via REPLACE.
-- =====================================================================

create or replace view public.v_upcoming_recurring
with (security_invoker = true) as
select
  r.id as recurring_id, r.userid, r.description,
  case
    when not r.amount_is_variable then r.amount
    when r.next_amount_confirmed_at is not null then r.next_amount
    else greatest(-cb.balance, 0)
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
  (r.amount_is_variable and r.next_amount_confirmed_at is null) as is_estimated_amount,
  r.next_due_date, a.account_type
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

-- =====================================================================
-- v_integrity_issues: new recurring_due_date_stale branch.
--
-- This view is rebuilt via DROP + CREATE (its own established pattern --
-- see 07_transfers.sql STEP 3/4), not CREATE OR REPLACE, so the full
-- definition is restated here with the four existing branches unchanged
-- plus the new one, and grants restated after (DROP VIEW does not
-- preserve them).
-- =====================================================================

drop view if exists public.v_integrity_issues;
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
where r.is_overdue

union all

select 'transfer_leg_mismatch', 'high', 'transactions', tg.transfer_group_id, tg.userid,
       format('transfer_group %s: %s leg(s), %s distinct amount(s), %s distinct type(s)',
              tg.transfer_group_id, tg.leg_count, tg.distinct_amounts, tg.distinct_types)
from (
  select transfer_group_id,
         userid,
         count(*)                         as leg_count,
         count(distinct amount)           as distinct_amounts,
         count(distinct transaction_type) as distinct_types
  from transactions
  where transfer_group_id is not null
  group by transfer_group_id, userid
) tg
where tg.leg_count <> 2
   or tg.distinct_amounts <> 1
   or tg.distinct_types <> 2

union all

-- Catches a missed recompute call site in lib/db/recurring.ts: the stored
-- next_due_date should always equal what resolve_recurring_due_date would
-- produce from the same row's next_run_date/business_day_offset/
-- non_business_day_rule. A mismatch here means a write path forgot to
-- recompute it, not that the SQL function is the source of truth (it
-- isn't -- see 24_recurring_business_day_rules.sql).
select 'recurring_due_date_stale', 'low', 'recurring_transactions', r.id, r.userid,
       format('stored next_due_date %s, recomputed %s', r.next_due_date,
              public.resolve_recurring_due_date(r.next_run_date, r.business_day_offset, r.non_business_day_rule))
from recurring_transactions r
where r.is_active
  and r.next_due_date is distinct from
      public.resolve_recurring_due_date(r.next_run_date, r.business_day_offset, r.non_business_day_rule);

grant select on public.v_integrity_issues to authenticated;
revoke all on public.v_integrity_issues from anon;
