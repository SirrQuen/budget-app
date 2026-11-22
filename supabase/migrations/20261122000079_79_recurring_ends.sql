-- =====================================================================
-- Sorrel 79: one rule for when a schedule ends
--
-- Found 2026-11-22: a schedule set to "Ends after 1 occurrence" was back
-- on the Recurring page for the next month after being confirmed once.
-- Phase 1's repro (docs/recurring-ends-test.sql) found four separate
-- end comparisons that disagreed:
--
--   v_upcoming_recurring   end_date >= current_date -- TODAY, not the
--                          occurrence. An "On date" schedule whose next
--                          cycle is past its end stayed in the view until
--                          the end date passed (C1); one whose last
--                          occurrence was still unanswered when the end
--                          date passed left the view, the queue and the
--                          forecast unanswered (C3).
--   expandOccurrences      cursor > endDate (lib/safeToSpendProjection.ts)
--   findSameBillPairs      endDate < nextDueDate -- the ADJUSTED date
--   Recurring page         no check at all
--
-- The rule (rulings 2026-11-22):
--   * An occurrence belongs to a schedule when its SCHEDULED date (the
--     cursor, next_run_date) is on or before end_date, and fewer than
--     occurrence_limit occurrences are done. The business-day adjustment
--     only moves when it posts; it never decides inclusion.
--   * Done = occurrences linked to the schedule (a transfer's two legs
--     are one). "Not happening" writes nothing, so it never counts.
--     Deleting a confirmed transaction brings its occurrence back.
--   * Finished = the pending occurrence doesn't belong. Derived, never
--     stored: raising N or moving the end date revives it.
--   * An occurrence on or before end_date stays until answered, however
--     long after the end date that is (C3).
--
-- recurring_is_finished() is that rule, the one SQL definition.
-- isFinished()/isScheduledOccurrence() (lib/recurringEnds.ts) are its
-- TypeScript twins; npm run test:parity:ends checks they agree on every
-- row of docs/recurring-ends-test.sql.
--
-- No last-scheduled-date column: the last occurrence's date needs the
-- cadence, and cadence math lives only in TypeScript
-- (lib/recurringCadence.ts) -- the database never recomputes a cadence.
-- The view exposes the bound (end_date) and the count
-- (occurrences_remaining); lib/recurringEnds.ts walks to the date.
--
-- v_upcoming_recurring keeps its columns, names and order, so
-- v_goal_monthly_holds and v_integrity_issues (which read it) take the
-- rule with no change of their own.
--
-- Also (ruled 2026-11-22): non_business_day_rule had two contradictory
-- CHECKs from the baseline -- rectx_non_business_day_rule_valid (none /
-- before / after) and recurring_nbd_rule_valid (none / forward /
-- backward). Only 'none' passed both, so the form's "earlier" / "later"
-- timing (before / after) could never save. none / before / after is
-- what the form writes (lib/recurringTiming.ts), what the TS cadence and
-- resolve_recurring_due_date() read, and NON_BUSINESS_DAY_RULES
-- (lib/businessDays.ts); forward / backward appear nowhere else. The
-- contradictory one is dropped. Checked read-only 2026-11-22: every row
-- is 'none' on production (91) and sorrel-dev (10), so no row changes
-- meaning.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. One set of non_business_day_rule values
-- ---------------------------------------------------------------------

alter table public.recurring_transactions drop constraint recurring_nbd_rule_valid;

comment on constraint rectx_non_business_day_rule_valid on public.recurring_transactions is
  'THE set of non_business_day_rule values: none / before / after -- NON_BUSINESS_DAY_RULES in lib/businessDays.ts, what the recurring form writes and resolve_recurring_due_date() reads. The contradictory recurring_nbd_rule_valid (forward / backward) was dropped by migration 79.';

-- ---------------------------------------------------------------------
-- 1. The rule
-- ---------------------------------------------------------------------

create function public.recurring_occurrences_remaining(
  p_occurrence_limit  integer,
  p_occurrences_done  bigint
) returns bigint
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_occurrence_limit is null then null
    else greatest(p_occurrence_limit - p_occurrences_done, 0)
  end
$$;

comment on function public.recurring_occurrences_remaining(integer, bigint) is
  'How many occurrences an "After N" schedule has left: N minus those done, never below 0; null when it has no limit. Twin of remainingOccurrences() in lib/recurringEnds.ts (migration 79).';

create function public.recurring_is_finished(
  p_next_run_date     date,
  p_end_date          date,
  p_occurrence_limit  integer,
  p_occurrences_done  bigint
) returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(public.recurring_occurrences_remaining(p_occurrence_limit, p_occurrences_done) = 0, false)
      or coalesce(p_next_run_date > p_end_date, false)
$$;

comment on function public.recurring_is_finished(date, date, integer, bigint) is
  'THE end rule: a schedule is finished when its pending occurrence doesn''t belong to it -- no occurrences left of its limit, or its SCHEDULED date (next_run_date, never the business-day-adjusted next_due_date) is after end_date. end_date is inclusive. Never compared to today: an occurrence on or before the end date stays until answered. Twin of isFinished() in lib/recurringEnds.ts; npm run test:parity:ends (migration 79).';

revoke execute on function public.recurring_occurrences_remaining(integer, bigint) from public, anon;
revoke execute on function public.recurring_is_finished(date, date, integer, bigint) from public, anon;
grant execute on function public.recurring_occurrences_remaining(integer, bigint) to authenticated, service_role;
grant execute on function public.recurring_is_finished(date, date, integer, bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. v_recurring_state: every schedule, finished ones included
-- ---------------------------------------------------------------------

create view public.v_recurring_state with (security_invoker = true) as
select r.id as recurring_id,
       r.userid,
       occ.n as occurrences_done,
       public.recurring_occurrences_remaining(r.occurrence_limit, occ.n) as occurrences_remaining,
       public.recurring_is_finished(r.next_run_date, r.end_date, r.occurrence_limit, occ.n) as is_finished
  from public.recurring_transactions r
  -- One per occurrence: a transfer's two legs share transfer_group_id.
  cross join lateral (
    select count(distinct coalesce(t.transfer_group_id, t.id)) as n
      from public.transactions t
     where t.recurringid = r.id
  ) occ;

comment on view public.v_recurring_state is
  'Every schedule''s end state -- paused and finished ones included: occurrences done (linked, a transfer''s legs counted once), occurrences remaining (null without a limit) and is_finished (recurring_is_finished). The Recurring page''s Ended section reads it; v_upcoming_recurring filters on it (migration 79).';

revoke all on table public.v_recurring_state from public, anon, authenticated, service_role;
grant select, references, trigger, truncate, maintain on table public.v_recurring_state to authenticated;
grant references, trigger, truncate, maintain on table public.v_recurring_state to service_role;

-- ---------------------------------------------------------------------
-- 3. v_upcoming_recurring: filtered by the rule
--
-- Migration 61's definition; the occurrence count now comes from
-- v_recurring_state and the WHERE clause is the rule instead of
-- `end_date >= current_date` and `n < occurrence_limit`.
-- occurrences_remaining keeps its name, type (bigint) and place.
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
    st.occurrences_remaining,
    ra.card_balance_owed,
    ra.amount_high,
    ra.amount_basis,
    ra.forecast_basis
   from public.recurring_transactions r
     join public.accounts a on a.id = r.accountid
     join public.v_recurring_amounts ra on ra.recurring_id = r.id
     join public.v_recurring_state st on st.recurring_id = r.id
     left join public.categories c on c.id = r.categoryid
     left join public.accounts ta on ta.id = r.to_accountid
  where r.is_active
    and not st.is_finished;

comment on view public.v_upcoming_recurring is
  'Active, unfinished schedules with their next occurrence and amounts. Finished is recurring_is_finished() via v_recurring_state -- the scheduled date against end_date, never today (migration 79).';
comment on column public.v_upcoming_recurring.occurrences_remaining is
  'occurrence_limit minus occurrences already confirmed -- counted as occurrences (a transfer''s two legs are one), not rows; null without a limit (v_recurring_state, migration 79).';

revoke all on table public.v_upcoming_recurring from public, anon, authenticated, service_role;
grant select, references, trigger, truncate, maintain on table public.v_upcoming_recurring to authenticated;
grant references, trigger, truncate, maintain on table public.v_upcoming_recurring to service_role;
