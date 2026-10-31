-- =====================================================================
-- EverNest 56: say what each recurring date column means
--
-- Comments only; no schema or behaviour change. Each meaning below
-- existed only in the code that reads the column. docs/phase-7-findings.md,
-- "Recurring dates: what each one means".
--
-- 55 is taken by docs/rollback/20261029000055_55_revert_spendable_checking_cash.sql,
-- which lives outside this directory.
-- =====================================================================

comment on column public.recurring_transactions.next_run_date is
  'The open occurrence''s raw cadence date: the cursor the schedule steps '
  'from, before business-day timing. One open occurrence per schedule. '
  'The form labels it "Next due date". For a transfer to a credit card it '
  'is the payment due date, and statement_day is walked back from it. '
  'next_due_date is this date after business_day_offset/non_business_day_rule.';

comment on column public.recurring_transactions.next_due_date is
  'next_run_date resolved by business_day_offset and non_business_day_rule '
  '(lib/businessDays.ts, written by the app; migration 24). The date the '
  'projection and the confirmation queue use, and the anchor '
  'date_tolerance_days widens.';

comment on column public.recurring_transactions.date_tolerance_days is
  '"Date varies": how many days the occurrence may land away from '
  'next_due_date. 0 = fixed date. Every type reads the early edge '
  '(next_due_date - N): the confirmation queue opens there, and an outflow '
  '(expense, transfer, card payment) is counted there. Only income reads '
  'the late edge (next_due_date + N), where the projection counts it. '
  'Never applies to statement_day. lib/recurringSchedule.ts.';

comment on column public.recurring_transactions.statement_day is
  'Variable card payments only (rectx_variable_requires_statement_day): '
  'the day of the month the card statement posts. A day, not a date: the '
  'statement date for a cycle is the closest of this day on or before the '
  'payment''s next_run_date (statementDateForCycle) -- the previous month '
  'when this day is later than the due day, which is the usual card '
  'layout. The "enter the amount" window runs from it through '
  'next_run_date (the raw date, not next_due_date). No tolerance: a '
  'statement that posts on another day is not handled.';
