-- =====================================================================
-- EverNest 23: Variable-amount recurring transfers
--
-- A credit card payment schedule doesn't know its own amount -- the
-- statement balance changes every month. This adds an opt-in mode to a
-- recurring TRANSFER (see 19_recurring_transfers) whose destination is a
-- Credit Card: instead of a fixed amount, the schedule carries a statement
-- day and waits for the user to confirm each cycle's amount once the
-- statement posts.
--
--   amount_is_variable        opt-in flag. Only meaningful for a transfer
--                              template (to_accountid set) -- a category
--                              schedule's amount is never variable.
--   statement_day              day of month (1-31) the card's statement
--                              posts. Purely descriptive -- the generator
--                              gates on next_amount_confirmed_at, not this.
--   next_amount                 the confirmed amount for the NEXT occurrence
--                              only. Cleared back to null the moment that
--                              occurrence posts (see lib/db/recurring.ts) --
--                              never a running/history value.
--   next_amount_confirmed_at   when next_amount was confirmed. Always set
--                              or cleared together with next_amount (see
--                              rectx_next_amount_confirmed_together below).
--
-- amount stays NOT NULL and unused for a variable schedule (defaults to 0
-- at creation) -- the source of truth for what actually posts is
-- next_amount once confirmed, or the live card-balance estimate
-- (v_upcoming_recurring) until then. There's no CHECK requiring amount > 0
-- on this table (unlike transactions.amount), so 0 is a legal placeholder.
-- =====================================================================

alter table recurring_transactions
  add column if not exists amount_is_variable boolean not null default false;

alter table recurring_transactions
  add column if not exists statement_day integer;

alter table recurring_transactions
  add column if not exists next_amount numeric;

alter table recurring_transactions
  add column if not exists next_amount_confirmed_at timestamptz;

alter table recurring_transactions drop constraint if exists rectx_statement_day_range;
alter table recurring_transactions add  constraint rectx_statement_day_range
  check (statement_day is null or (statement_day between 1 and 31)) not valid;
alter table recurring_transactions validate constraint rectx_statement_day_range;

-- Mirrors rectx_category_required's shape: a variable schedule only makes
-- sense for a transfer template, same reason RecurringForm only offers the
-- toggle once a Credit Card destination account is chosen.
alter table recurring_transactions drop constraint if exists rectx_variable_requires_transfer;
alter table recurring_transactions add  constraint rectx_variable_requires_transfer
  check (not amount_is_variable or to_accountid is not null) not valid;
alter table recurring_transactions validate constraint rectx_variable_requires_transfer;

alter table recurring_transactions drop constraint if exists rectx_variable_requires_statement_day;
alter table recurring_transactions add  constraint rectx_variable_requires_statement_day
  check (not amount_is_variable or statement_day is not null) not valid;
alter table recurring_transactions validate constraint rectx_variable_requires_statement_day;

alter table recurring_transactions drop constraint if exists rectx_next_amount_nonnegative;
alter table recurring_transactions add  constraint rectx_next_amount_nonnegative
  check (next_amount is null or next_amount >= 0) not valid;
alter table recurring_transactions validate constraint rectx_next_amount_nonnegative;

-- A fixed-amount schedule never carries a pending confirmation -- this is
-- what the update action's "turn variable off" path relies on to leave the
-- row in a state the constraints below both still accept.
alter table recurring_transactions drop constraint if exists rectx_next_amount_requires_variable;
alter table recurring_transactions add  constraint rectx_next_amount_requires_variable
  check (next_amount is null or amount_is_variable) not valid;
alter table recurring_transactions validate constraint rectx_next_amount_requires_variable;

-- next_amount and next_amount_confirmed_at are set, and cleared, together --
-- see lib/db/recurring.ts's confirmVariableAmount (sets both) and
-- generateDueOccurrences (clears both after the confirmed occurrence posts).
alter table recurring_transactions drop constraint if exists rectx_next_amount_confirmed_together;
alter table recurring_transactions add  constraint rectx_next_amount_confirmed_together
  check ((next_amount is null) = (next_amount_confirmed_at is null)) not valid;
alter table recurring_transactions validate constraint rectx_next_amount_confirmed_together;

-- =====================================================================
-- v_upcoming_recurring: "amount" becomes the amount actually due --
-- next_amount once confirmed, otherwise a live estimate off the linked
-- card's current balance, unchanged for a non-variable schedule. Every
-- existing reader (getSafeToSpend, UpcomingList, RecurringRow) gets the
-- right number without a code change; is_estimated_amount is the new flag
-- that tells them to LABEL it as a guess (CLAUDE.md: never present a guess
-- as a known figure).
--
-- v_account_balances.balance is negative for a Credit Card that's owed
-- (06_liability_sign) -- greatest(-cb.balance, 0) is the amount owed, and
-- floors at zero for a card currently in credit (a positive balance) rather
-- than reporting that credit as a commitment. Deliberately NOT abs(balance):
-- abs() would turn an in-credit balance into a false positive commitment
-- instead of zero.
--
-- CREATE OR REPLACE, not drop+create -- v_integrity_issues selects named
-- columns from this view (07_transfers.sql). The new columns are appended
-- strictly after category_type, the last column 21_upcoming_recurring_
-- category_type added; "amount"'s definition changes but its name and
-- type (numeric) don't, which CREATE OR REPLACE allows.
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
  (r.next_run_date - current_date) as days_until,
  (r.next_run_date < current_date) as is_overdue,
  r.interval_count, r.occurrence_limit,
  r.to_accountid, ta.account_name as to_account_name,
  c.category_type,
  r.amount_is_variable, r.statement_day, r.next_amount, r.next_amount_confirmed_at,
  (r.amount_is_variable and r.next_amount_confirmed_at is null) as is_estimated_amount
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
