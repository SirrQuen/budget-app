-- =====================================================================
-- EverNest 18: Recurring schedule -- cadence + end-condition fields
--
-- The schedule picker keeps to three cadences people actually use:
-- monthly on a day, every N weeks on a weekday, yearly on a date.
-- day-of-month/weekday/month-day are still never stored -- lib/db/
-- recurring.ts derives them from next_run_date, same as before this
-- migration. What's new:
--
--   interval_count    the N in "every N weeks" (frequency = 'Weekly'
--                      only; stays 1, unused, for Monthly/Yearly).
--                      rectx_frequency_check is NOT narrowed here --
--                      Daily/Biweekly/Quarterly stay valid for any
--                      existing row, the app just stops offering them
--                      going forward, folding "every 2 weeks" into
--                      Weekly + interval_count instead.
--
--   occurrence_limit   "ends after N occurrences." null = no limit --
--                      end_date (already nullable) covers "ends on a
--                      date"; both null means never. Progress is
--                      COMPUTED from count(transactions where
--                      recurringid = id), never a stored counter --
--                      same "computed, not cached" rule the balance
--                      views already follow (see CLAUDE.md).
-- =====================================================================

alter table recurring_transactions
  add column if not exists interval_count integer not null default 1;

alter table recurring_transactions drop constraint if exists rectx_interval_count_positive;
alter table recurring_transactions add  constraint rectx_interval_count_positive
  check (interval_count >= 1) not valid;
alter table recurring_transactions validate constraint rectx_interval_count_positive;

alter table recurring_transactions
  add column if not exists occurrence_limit integer;

alter table recurring_transactions drop constraint if exists rectx_occurrence_limit_positive;
alter table recurring_transactions add  constraint rectx_occurrence_limit_positive
  check (occurrence_limit is null or occurrence_limit > 0) not valid;
alter table recurring_transactions validate constraint rectx_occurrence_limit_positive;

-- CREATE OR REPLACE, not drop+create -- v_integrity_issues (07_transfers.sql)
-- selects named columns from this view, so the two new columns are
-- appended strictly after is_overdue (Postgres refuses to reorder an
-- existing view's columns via REPLACE; appending at the end is the only
-- safe way to grow a view a dependent already selects from by name).
--
-- An exhausted schedule (already generated occurrence_limit transactions)
-- drops out of "upcoming" the same way an ended-by-date one already does.
create or replace view public.v_upcoming_recurring
with (security_invoker = true) as
select
  r.id as recurring_id, r.userid, r.description, r.amount, r.frequency,
  r.next_run_date, r.start_date, r.end_date,
  r.accountid, a.account_name, a.color as account_color,
  r.categoryid, c.category_name, c.icon as category_icon, c.color as category_color,
  (r.next_run_date - current_date) as days_until,
  (r.next_run_date < current_date) as is_overdue,
  r.interval_count, r.occurrence_limit
from recurring_transactions r
join accounts a   on a.id = r.accountid
join categories c on c.id = r.categoryid
where r.is_active
  and (r.end_date is null or r.end_date >= current_date)
  and (r.occurrence_limit is null
       or (select count(*) from transactions t where t.recurringid = r.id) < r.occurrence_limit);

-- Privileges attach to the view object and survive CREATE OR REPLACE, but
-- stated explicitly so this migration doesn't depend on that surviving --
-- matches the grant this view already had (04_hardening.sql STEP 10).
grant select on public.v_upcoming_recurring to authenticated;
revoke all on public.v_upcoming_recurring from anon;
