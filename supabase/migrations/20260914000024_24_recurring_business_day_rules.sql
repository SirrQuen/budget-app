-- =====================================================================
-- EverNest 24: Business-day resolution for recurring schedules
--
-- Two knobs, per schedule:
--
--   business_day_offset    "pay N business days after the anchor." N=0
--                            means "on the anchor itself" -- the common
--                            case, and what every existing row already
--                            means implicitly. Capped at 10: this is a
--                            payroll/billing offset, not a general-purpose
--                            date-math primitive, and the cap keeps the
--                            catch-up prefilter in lib/db/recurring.ts
--                            (generateDueOccurrences) boundable.
--
--   non_business_day_rule   only consulted when business_day_offset = 0:
--                            if the anchor itself lands on a weekend or
--                            holiday, 'before' shifts to the nearest prior
--                            business day, 'after' to the nearest
--                            following one, 'none' leaves it alone. Counting
--                            forward N>=1 business days (offset > 0) always
--                            lands on a business day already, so the rule
--                            has nothing to do in that case.
--
-- next_due_date is the resolved result -- offset and rule applied to
-- next_run_date. next_run_date itself keeps its existing meaning
-- unchanged: the raw cadence pointer nextOccurrenceISO steps in
-- lib/db/recurring.ts, anchored off start_date the same way it always has
-- (see addMonthsClampedISO's comment there for why that pointer must never
-- itself be business-day-shifted -- doing so would drift a Monthly/
-- Quarterly/Yearly schedule's day-of-month the same way deriving anchorDay
-- from a clamped date would). next_due_date is what every user-facing read
-- (v_upcoming_recurring, getSafeToSpend, getUpcoming, the dashboard hero)
-- should use instead.
--
-- next_due_date is computed and written by the application (lib/db/
-- recurring.ts's resolveDueDate, backed by lib/businessDays.ts), not by a
-- trigger here -- see 25_bank_holidays.sql for why: the resolution needs
-- bank_holidays, and keeping one real implementation (TypeScript, unit-
-- testable with no database) plus a SQL-side integrity check beats two
-- parallel implementations kept in sync by hand.
--
-- Every existing row keeps business_day_offset = 0 and
-- non_business_day_rule = 'none', so next_due_date backfills to exactly
-- next_run_date for all of them -- zero behavior change on deploy.
-- =====================================================================

alter table recurring_transactions
  add column if not exists business_day_offset integer not null default 0;

alter table recurring_transactions drop constraint if exists rectx_business_day_offset_range;
alter table recurring_transactions add  constraint rectx_business_day_offset_range
  check (business_day_offset between 0 and 10) not valid;
alter table recurring_transactions validate constraint rectx_business_day_offset_range;

alter table recurring_transactions
  add column if not exists non_business_day_rule text not null default 'none';

alter table recurring_transactions drop constraint if exists rectx_non_business_day_rule_valid;
alter table recurring_transactions add  constraint rectx_non_business_day_rule_valid
  check (non_business_day_rule in ('none', 'before', 'after')) not valid;
alter table recurring_transactions validate constraint rectx_non_business_day_rule_valid;

alter table recurring_transactions
  add column if not exists next_due_date date;

update recurring_transactions
   set next_due_date = next_run_date
 where next_due_date is null;

alter table recurring_transactions
  alter column next_due_date set not null;
