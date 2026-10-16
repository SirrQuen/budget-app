-- =====================================================================
-- EverNest 48: the balance anchor gets a time -- one rule decides which
-- transactions an account's balance counts
--
-- An account's balance is opening_balance plus the transactions after
-- its anchor. The anchor was a date only (opening_date, migration 22),
-- and v_account_balances counted `transaction_date >= opening_date`. That
-- double-counts: log a $40 purchase at noon, set the balance from the
-- bank app at 5pm (the bank figure already includes the $40), and both
-- the figure and the $40 count.
--
-- The rule, decided by when things were recorded, not guessed from the
-- date:
--
--   dated AFTER the anchor date   always counts
--   dated BEFORE the anchor date  never counts
--   dated ON the anchor date      counts if recorded (created_at) after
--                                 the anchor was set (opening_set_at)
--
-- It lives in exactly one place, anchor_includes(). v_account_balances
-- and the transaction form's "won't change that balance" note both read
-- it -- the note through counts_toward_balance (a computed column on a
-- stored transaction) or counts_toward_balance_preview() (for a date or
-- account the user is still choosing). Never write the comparison out
-- again, in SQL or TypeScript.
--
-- The rule rests on two timestamps, so both are set by the database only:
--
--   transactions.created_at  now() on insert, unchanged on update. The
--                            table grant is ALL, so until now a client
--                            could write it.
--   accounts.opening_set_at  now() on insert, and now() on any UPDATE
--                            whose SET list names opening_balance or
--                            opening_date (re-setting the balance);
--                            otherwise unchanged. The app posts those
--                            columns only when the user edited them
--                            (lib/actions/accounts.ts), so a rename
--                            leaves the anchor alone.
--
-- Backfill (no real users yet; balances must not move in this
-- migration -- the owner re-anchors by hand afterwards, which stamps an
-- exact opening_set_at):
--
--   opening_date = the account's creation day in the user's zone
--       -> opening_set_at = created_at (the real moment the balance was
--          entered)
--   otherwise
--       -> start of opening_date in the user's zone
--
-- Both keep every transaction on the anchor day counted, as `>=` did,
-- except one logged before the start of its own date (an entry made in
-- advance) on an account in the second branch.
--
-- The user's zone is settings.timezone when Postgres knows the name,
-- else UTC -- the same fallback as apply_user_timezone() (migration 40).
-- settings.timezone is only length-checked, so an unknown name must not
-- reach AT TIME ZONE and fail the migration.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. transactions.created_at: set by the database only
-- ---------------------------------------------------------------------
create or replace function public.lock_transaction_created_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

revoke all on function public.lock_transaction_created_at() from public, anon, authenticated;

drop trigger if exists trg_transactions_created_at on public.transactions;
create trigger trg_transactions_created_at
  before insert or update on public.transactions
  for each row execute function public.lock_transaction_created_at();


-- ---------------------------------------------------------------------
-- 2. accounts.opening_set_at, backfilled
-- ---------------------------------------------------------------------
alter table public.accounts
  add column if not exists opening_set_at timestamptz;

-- The backfill is not an edit: keep updated_at as it was.
alter table public.accounts disable trigger trg_accounts_updated_at;

with zone as (
  select a.id,
         coalesce(
           (select s.timezone
              from public.settings s
             where s.userid = a.userid
               and s.timezone in (select name from pg_timezone_names)),
           'UTC') as tz
    from public.accounts a
)
update public.accounts a
   set opening_set_at =
         case
           when a.opening_date = (a.created_at at time zone zone.tz)::date
             then a.created_at
           else a.opening_date::timestamp at time zone zone.tz
         end
  from zone
 where zone.id = a.id;

alter table public.accounts enable trigger trg_accounts_updated_at;

alter table public.accounts
  alter column opening_set_at set default now(),
  alter column opening_set_at set not null;

comment on column public.accounts.opening_set_at is
  'When opening_balance/opening_date were last set. Decides transactions dated ON opening_date: counted only if created after this (anchor_includes). Set by triggers only: now() on insert and on any update naming an anchor column.';


-- ---------------------------------------------------------------------
-- 3. accounts.opening_set_at: set by the database only
--
-- Two BEFORE triggers, and their order matters. Postgres fires
-- same-event triggers in name order, so _1_lock runs first and pins the
-- column (now() on insert, the old value on update), then _2_stamp
-- re-stamps it when the UPDATE's SET list names an anchor column --
-- even with an unchanged value: posting the anchor is re-setting it.
-- Renaming either trigger can swap the order.
-- ---------------------------------------------------------------------
create or replace function public.lock_account_opening_set_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.opening_set_at := now();
  else
    new.opening_set_at := old.opening_set_at;
  end if;
  return new;
end;
$$;

create or replace function public.stamp_account_opening_set_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.opening_set_at := now();
  return new;
end;
$$;

revoke all on function public.lock_account_opening_set_at() from public, anon, authenticated;
revoke all on function public.stamp_account_opening_set_at() from public, anon, authenticated;

drop trigger if exists trg_accounts_anchor_1_lock on public.accounts;
create trigger trg_accounts_anchor_1_lock
  before insert or update on public.accounts
  for each row execute function public.lock_account_opening_set_at();

drop trigger if exists trg_accounts_anchor_2_stamp on public.accounts;
create trigger trg_accounts_anchor_2_stamp
  before update of opening_balance, opening_date on public.accounts
  for each row execute function public.stamp_account_opening_set_at();


-- ---------------------------------------------------------------------
-- 4. The rule
-- ---------------------------------------------------------------------
create or replace function public.anchor_includes(
  p_transaction_date date,
  p_recorded_at      timestamptz,
  p_anchor_date      date,
  p_anchor_set_at    timestamptz
)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(
           p_transaction_date > p_anchor_date
           or (p_transaction_date = p_anchor_date and p_recorded_at > p_anchor_set_at),
           false);
$$;

comment on function public.anchor_includes(date, timestamptz, date, timestamptz) is
  'THE balance anchor rule: does a transaction dated p_transaction_date, recorded at p_recorded_at, count toward a balance anchored at p_anchor_date, set at p_anchor_set_at? After the date always; before never; on it only if recorded after the anchor was set. v_account_balances, counts_toward_balance and counts_toward_balance_preview call it. Never restate the comparison.';

revoke all on function public.anchor_includes(date, timestamptz, date, timestamptz) from public, anon;
grant execute on function public.anchor_includes(date, timestamptz, date, timestamptz) to authenticated;


-- ---------------------------------------------------------------------
-- 5. v_account_balances: counts what anchor_includes() says, nothing
--    else changes
-- ---------------------------------------------------------------------
create or replace view public.v_account_balances
with (security_invoker = true) as
select
  a.id as account_id, a.userid, a.account_name, a.account_type, a.institution,
  a.color, a.account_icon, a.is_active, a.opening_balance,
  a.opening_balance + coalesce(t.delta, 0)  as balance,
  coalesce(t.transaction_count, 0)          as transaction_count,
  t.first_transaction_date, t.last_transaction_date
from public.accounts a
left join lateral (
  select sum(public.signed_amount(tr.amount, tr.transaction_type)) as delta,
         count(*)                 as transaction_count,
         min(tr.transaction_date) as first_transaction_date,
         max(tr.transaction_date) as last_transaction_date
  from public.transactions tr
  where tr.accountid = a.id
    and public.anchor_includes(tr.transaction_date, tr.created_at,
                               a.opening_date, a.opening_set_at)
) t on true;


-- ---------------------------------------------------------------------
-- 6. The form note's reads
--
-- counts_toward_balance(transactions): a PostgREST computed column --
--   select=*,counts_toward_balance on /transactions.
-- counts_toward_balance_preview(): the same answer for a date/account
--   the user is still choosing. p_transaction_id names the transaction
--   being edited (its own created_at decides); null means a new one,
--   recorded now.
--
-- Both are security invoker: RLS scopes the account (and transaction)
-- lookups, so another user's id answers null, same as a made-up one.
-- ---------------------------------------------------------------------
create or replace function public.counts_toward_balance(t public.transactions)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select anchor_includes(t.transaction_date, t.created_at, a.opening_date, a.opening_set_at)
    from accounts a
   where a.id = t.accountid;
$$;

create or replace function public.counts_toward_balance_preview(
  p_accountid        uuid,
  p_transaction_date date,
  p_transaction_id   uuid default null
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select anchor_includes(
           p_transaction_date,
           coalesce((select t.created_at from transactions t where t.id = p_transaction_id), now()),
           a.opening_date,
           a.opening_set_at)
    from accounts a
   where a.id = p_accountid;
$$;

revoke all on function public.counts_toward_balance(public.transactions) from public, anon;
grant execute on function public.counts_toward_balance(public.transactions) to authenticated;
revoke all on function public.counts_toward_balance_preview(uuid, date, uuid) from public, anon;
grant execute on function public.counts_toward_balance_preview(uuid, date, uuid) to authenticated;
