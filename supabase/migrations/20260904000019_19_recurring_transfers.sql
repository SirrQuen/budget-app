-- =====================================================================
-- EverNest 19: Recurring transfers
--
-- A recurring transfer (e.g. "pay the card off, monthly") posts the same
-- two-leg shape a manual transfer does (createTransfer in
-- lib/db/transactions.ts): an Expense leg on the source account, an
-- Income leg on the destination, sharing a transfer_group_id, no
-- category on either. This gives recurring_transactions the fields to
-- describe that template, mirroring how 07_transfers.sql made
-- transactions.categoryid nullable for the same reason.
--
--   to_accountid   -- destination account. null = an ordinary category
--                     schedule (existing behaviour, untouched); set = a
--                     recurring transfer, and accountid is then the
--                     source ("from") account -- same column, no rename,
--                     since a category schedule and a transfer's source
--                     account are the same concept either way.
--
-- recurringid + transaction_date is no longer unique on its own: a
-- transfer occurrence posts TWO rows for the same date under the same
-- recurringid. transaction_type distinguishes them (one Expense, one
-- Income), so the idempotency index widens to include it -- still exactly
-- one row per (schedule, date, direction), which is what actually needs
-- guarding against a double post.
-- =====================================================================

do $do$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recurring_transactions'
      and column_name = 'categoryid' and is_nullable = 'NO'
  ) then
    alter table recurring_transactions alter column categoryid drop not null;
  end if;
end
$do$;

alter table recurring_transactions
  add column if not exists to_accountid uuid;

alter table recurring_transactions drop constraint if exists recurring_transactions_to_accountid_fkey;
alter table recurring_transactions add  constraint recurring_transactions_to_accountid_fkey
  foreign key (to_accountid) references accounts(id) on delete restrict;

-- A category schedule needs categoryid; a transfer template needs neither
-- category nor a second category -- to_accountid alone marks it as one.
-- Mirrors transactions_category_required (07_transfers.sql) exactly.
alter table recurring_transactions drop constraint if exists rectx_category_required;
alter table recurring_transactions add  constraint rectx_category_required
  check (to_accountid is not null or categoryid is not null) not valid;
alter table recurring_transactions validate constraint rectx_category_required;

-- Same "two different accounts" rule createTransfer enforces at write
-- time -- stated here too so a bad row can't reach the generator.
alter table recurring_transactions drop constraint if exists rectx_transfer_accounts_differ;
alter table recurring_transactions add  constraint rectx_transfer_accounts_differ
  check (to_accountid is null or to_accountid <> accountid) not valid;
alter table recurring_transactions validate constraint rectx_transfer_accounts_differ;

drop index if exists recurring_tx_no_double_post;
create unique index if not exists recurring_tx_no_double_post
  on transactions (recurringid, transaction_date, transaction_type)
  where recurringid is not null;

-- CREATE OR REPLACE, not drop+create -- same reason as migration 18:
-- v_integrity_issues selects named columns from this view. categories and
-- the destination account both become LEFT JOINs (a transfer template has
-- no category, and no row until now ever needed a second account join),
-- and to_accountid/to_account_name are appended after the columns 18
-- already added, so the column list stays purely additive throughout.
create or replace view public.v_upcoming_recurring
with (security_invoker = true) as
select
  r.id as recurring_id, r.userid, r.description, r.amount, r.frequency,
  r.next_run_date, r.start_date, r.end_date,
  r.accountid, a.account_name, a.color as account_color,
  r.categoryid, c.category_name, c.icon as category_icon, c.color as category_color,
  (r.next_run_date - current_date) as days_until,
  (r.next_run_date < current_date) as is_overdue,
  r.interval_count, r.occurrence_limit,
  r.to_accountid, ta.account_name as to_account_name
from recurring_transactions r
join accounts a        on a.id  = r.accountid
left join categories c on c.id  = r.categoryid
left join accounts ta  on ta.id = r.to_accountid
where r.is_active
  and (r.end_date is null or r.end_date >= current_date)
  and (r.occurrence_limit is null
       or (select count(*) from transactions t where t.recurringid = r.id) < r.occurrence_limit);

grant select on public.v_upcoming_recurring to authenticated;
revoke all on public.v_upcoming_recurring from anon;
