-- =====================================================================
-- EverNest 41: bank_holidays follows the Federal Reserve, not OPM
--
-- Migration 25 seeded holidays with OPM's federal-employee observance:
-- a holiday on Saturday is observed the preceding Friday. Banks don't
-- follow that half of the rule. The Federal Reserve -- whose closures are
-- what stop ACH settling -- stays OPEN on that Friday ("For holidays
-- falling on Saturday, Federal Reserve Banks and Branches will be open
-- the preceding Friday"). Sunday holidays ARE observed the following
-- Monday by the Fed, so those rows stay.
--
-- With the Friday wrongly closed, a payday on Fri 2026-07-03 under
-- non_business_day_rule = 'before' resolved to Thu 07-02: income a day
-- early, which breaks "uncertainty always pushes the forecast down".
-- 'after' and business_day_offset skipped a real business day the other
-- way.
--
-- Removed (every Saturday-observed Friday in the seeded 2026-2035 range,
-- computed from the five fixed-date holidays):
--   2026-07-03 Independence Day      2032-06-18 Juneteenth
--   2027-06-18 Juneteenth            2032-12-24 Christmas Day
--   2027-12-24 Christmas Day         2032-12-31 New Year's Day (2033)
--   2027-12-31 New Year's Day (2028) 2034-11-10 Veterans Day
--   2028-11-10 Veterans Day
--
-- lib/businessDays.ts reads this table, so the TypeScript resolver picks
-- the change up with no code change.
-- =====================================================================

-- Stored next_due_date values were resolved against the old calendar.
-- After the delete, recompute only the rows whose resolution walked
-- across a removed date AND now resolve differently -- everything else
-- is left untouched, so this can't paper over an unrelated drift that
-- v_integrity_issues should still report.

delete from public.bank_holidays
where date = any (array[
  '2026-07-03', '2027-06-18', '2027-12-24', '2027-12-31', '2028-11-10',
  '2032-06-18', '2032-12-24', '2032-12-31', '2034-11-10'
]::date[]);

update public.recurring_transactions t
set next_due_date = public.resolve_recurring_due_date(
      t.next_run_date, t.business_day_offset, t.non_business_day_rule)
where t.next_due_date is distinct from public.resolve_recurring_due_date(
        t.next_run_date, t.business_day_offset, t.non_business_day_rule)
  and exists (
    select 1
    from unnest(array[
      '2026-07-03', '2027-06-18', '2027-12-24', '2027-12-31', '2028-11-10',
      '2032-06-18', '2032-12-24', '2032-12-31', '2034-11-10'
    ]::date[]) as removed(date)
    where removed.date between least(t.next_run_date, t.next_due_date) - 1
                           and greatest(t.next_run_date, t.next_due_date) + 1
  );


-- =====================================================================
-- Verify
-- =====================================================================
-- No Friday row whose following day is one of the five fixed dates:
-- select * from public.bank_holidays
-- where extract(isodow from date) = 5
--   and to_char(date + 1, 'MM-DD') in ('01-01', '06-19', '07-04', '11-11', '12-25');
-- (expect 0 rows)
--
-- And no recompute left behind:
-- select * from public.v_integrity_issues where issue_type = 'recurring_due_date_stale';
