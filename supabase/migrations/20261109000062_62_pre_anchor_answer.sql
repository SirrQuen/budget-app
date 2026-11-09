-- =====================================================================
-- Sorrel 62: a transaction dated before the balance anchor asks whether
-- the balance already included it
--
-- The anchor rule (migration 48) assumes the balance a person entered
-- already includes everything dated up to the moment they entered it.
-- That is true of POSTED activity and false of PENDING activity: a charge
-- held Monday, a balance read from the bank Tuesday (which leaves the
-- pending charge out), and the charge posted Thursday backdated to
-- Monday. Logged on Monday's date, the rule excluded it, and the balance
-- stayed short by that amount with nothing on screen to say so
-- (docs/Budgets-Reminders-and-Pending.md, item 4).
--
-- The app can't tell that case from someone back-filling last month's
-- spending (which WAS in the figure), so it asks. Two columns hold the
-- answer:
--
--   counts_despite_anchor  true  = "No, add it to my balance"
--                          false = "Yes, it's already counted"
--                          null  = not asked (dated after the anchor, or
--                                  a row from before this migration)
--   anchor_answer_set_at   the opening_set_at of the anchor the answer
--                          was given against
--
-- AN OVERRIDE IS VALID ONLY AGAINST THE ANCHOR IT ANSWERED. Setting a new
-- balance stamps a new opening_set_at (migration 48), and the new figure
-- supersedes every earlier answer, so the rule counts an override only
-- while anchor_answer_set_at equals the account's current opening_set_at.
-- Nothing is cleared when the balance is re-set; the stored answer simply
-- stops applying, and the transaction form says so.
--
-- The answer flows through THE rule, anchor_includes(), which gains the
-- two inputs. v_account_balances, counts_toward_balance() and the form's
-- preview all call it; nothing restates the comparison.
--
-- An answer is REQUIRED for every write that puts a transaction before
-- its account's anchor -- trg_transactions_anchor_answer refuses it
-- otherwise, so every path is covered: the transaction form, quick add,
-- a recurring confirmation (one tap or the sheet), Confirm all, a new
-- transfer, and update_transfer(). Either silent default is wrong: "yes"
-- reproduces the bug, "no" double-counts back-filled history.
--
-- Rows written before this migration keep counting exactly as they did:
-- no answer means the date rule alone decides, as before. No balance
-- moves when this migration runs.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The answer columns
-- ---------------------------------------------------------------------
alter table public.transactions
  add column counts_despite_anchor boolean,
  add column anchor_answer_set_at  timestamptz;

alter table public.transactions
  add constraint transactions_anchor_answer_pair
  check ((counts_despite_anchor is null) = (anchor_answer_set_at is null));

comment on column public.transactions.counts_despite_anchor is
  'The answer to "was it already included in that balance?" for a transaction dated before its account''s anchor: true = no, add it (counts despite its date); false = yes, already counted; null = not asked. Applies only while anchor_answer_set_at equals the account''s opening_set_at (migration 62).';
comment on column public.transactions.anchor_answer_set_at is
  'opening_set_at of the anchor counts_despite_anchor answered. A new balance stamps a new opening_set_at and voids the answer (migration 62).';


-- ---------------------------------------------------------------------
-- 2. THE rule, with the answer as two more inputs
--
-- A new six-argument anchor_includes() replaces the four-argument one.
-- Everything that called the old one is re-pointed below, then the old
-- one is dropped, so exactly one rule remains.
-- ---------------------------------------------------------------------
create function public.anchor_includes(
  p_transaction_date      date,
  p_recorded_at           timestamptz,
  p_anchor_date           date,
  p_anchor_set_at         timestamptz,
  p_counts_despite_anchor boolean,
  p_answer_set_at         timestamptz
)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(
           p_transaction_date > p_anchor_date
           or (p_transaction_date = p_anchor_date and p_recorded_at > p_anchor_set_at)
           or (p_counts_despite_anchor and p_answer_set_at = p_anchor_set_at),
           false);
$$;

comment on function public.anchor_includes(date, timestamptz, date, timestamptz, boolean, timestamptz) is
  'THE balance anchor rule: does a transaction dated p_transaction_date, recorded at p_recorded_at, count toward a balance anchored at p_anchor_date, set at p_anchor_set_at? After the date always; before never; on it only if recorded after the anchor was set -- unless the person answered "No, add it to my balance" (p_counts_despite_anchor) against THIS anchor (p_answer_set_at = p_anchor_set_at). Pass null, null for the date rule alone. v_account_balances, counts_toward_balance, balance_anchor_preview and trg_transactions_anchor_answer call it. Never restate the comparison (migrations 48, 62).';

revoke all on function public.anchor_includes(date, timestamptz, date, timestamptz, boolean, timestamptz) from public, anon;
grant execute on function public.anchor_includes(date, timestamptz, date, timestamptz, boolean, timestamptz) to authenticated;


-- ---------------------------------------------------------------------
-- 3. v_account_balances: same columns, the answer now counts
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
                               a.opening_date, a.opening_set_at,
                               tr.counts_despite_anchor, tr.anchor_answer_set_at)
) t on true;


-- ---------------------------------------------------------------------
-- 4. counts_toward_balance(transactions): the stored row, answer included
-- ---------------------------------------------------------------------
create or replace function public.counts_toward_balance(t public.transactions)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select anchor_includes(t.transaction_date, t.created_at, a.opening_date, a.opening_set_at,
                         t.counts_despite_anchor, t.anchor_answer_set_at)
    from accounts a
   where a.id = t.accountid;
$$;


-- ---------------------------------------------------------------------
-- 5. balance_anchor_preview(): what the form asks, for an account and
--    date the person is still choosing
--
-- Replaces counts_toward_balance_preview(). counts_by_date is the date
-- rule alone (no answer) -- false means the question applies. The anchor
-- figures are what the question names ("your balance of $1,240 on
-- 3 November"), and anchor_set_at is what the answer is stored against.
-- p_transaction_id names a transaction being edited (its own created_at
-- decides); null means a new one, recorded now. security invoker: RLS
-- scopes both lookups, so another user's id returns no row.
-- ---------------------------------------------------------------------
drop function public.counts_toward_balance_preview(uuid, date, uuid);

create function public.balance_anchor_preview(
  p_accountid        uuid,
  p_transaction_date date,
  p_transaction_id   uuid default null
)
returns table (
  counts_by_date  boolean,
  anchor_balance  numeric,
  anchor_date     date,
  anchor_set_at   timestamptz,
  account_type    text
)
language sql
stable
security invoker
set search_path = public
as $$
  select anchor_includes(
           p_transaction_date,
           coalesce((select t.created_at from transactions t where t.id = p_transaction_id), now()),
           a.opening_date,
           a.opening_set_at,
           null, null),
         a.opening_balance,
         a.opening_date,
         a.opening_set_at,
         a.account_type
    from accounts a
   where a.id = p_accountid;
$$;

comment on function public.balance_anchor_preview(uuid, date, uuid) is
  'For the transaction form and the confirm sheet: would a transaction on this account and date count by the date rule alone (counts_by_date), and the anchor it would be asked about (balance, date, set_at, account type). false = ask "was it already included in that balance?" (migration 62).';

revoke all on function public.balance_anchor_preview(uuid, date, uuid) from public, anon;
grant execute on function public.balance_anchor_preview(uuid, date, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 6. The old four-argument rule goes, so only one remains
-- ---------------------------------------------------------------------
drop function public.anchor_includes(date, timestamptz, date, timestamptz);


-- ---------------------------------------------------------------------
-- 7. The answer is required: trg_transactions_anchor_answer
--
-- Fires on insert, and on any update that names the account, the date or
-- the answer. When the date rule alone says the row won't count, an
-- answer must be present and must answer the account's CURRENT anchor;
-- when the date rule says it counts, there is no question, and any
-- answer is cleared rather than left to look meaningful.
--
-- An update that names none of those columns (a description, a note, an
-- amount through PostgREST that sends only that) doesn't fire it, so a
-- row from before this migration is never forced to answer by an edit
-- that doesn't touch what the rule reads.
--
-- Two SQLSTATEs the app recognises (lib/db/errors.ts):
--   SRA01  an answer is required
--   SRA02  the answer was given against a balance that has since changed
-- ---------------------------------------------------------------------
create or replace function public.require_anchor_answer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_anchor_date   date;
  v_anchor_set_at timestamptz;
begin
  select a.opening_date, a.opening_set_at
    into v_anchor_date, v_anchor_set_at
    from public.accounts a
   where a.id = new.accountid;
  if not found then
    return new;  -- the foreign key reports a missing account
  end if;

  -- The recorded time as trg_transactions_created_at will leave it: that
  -- trigger fires after this one (trigger names run in order), so
  -- new.created_at could still hold a client-supplied value here.
  if public.anchor_includes(new.transaction_date,
                            case when tg_op = 'INSERT' then now() else old.created_at end,
                            v_anchor_date, v_anchor_set_at, null, null) then
    new.counts_despite_anchor := null;
    new.anchor_answer_set_at  := null;
    return new;
  end if;

  if new.counts_despite_anchor is null then
    raise exception 'This is dated before the account''s balance date. Say whether that balance already included it.'
      using errcode = 'SRA01';
  end if;
  if new.anchor_answer_set_at is distinct from v_anchor_set_at then
    raise exception 'The account''s balance changed since this was answered. Answer again for the new balance.'
      using errcode = 'SRA02';
  end if;

  return new;
end;
$$;

comment on function public.require_anchor_answer() is
  'BEFORE INSERT/UPDATE OF accountid, transaction_date, counts_despite_anchor, anchor_answer_set_at on transactions: a row the date rule excludes needs an answer against the account''s current anchor (SRA01 missing, SRA02 stale); a row the date rule counts carries none (migration 62).';

revoke all on function public.require_anchor_answer() from public, anon, authenticated;

create trigger trg_transactions_anchor_answer
  before insert or update of accountid, transaction_date, counts_despite_anchor, anchor_answer_set_at
  on public.transactions
  for each row execute function public.require_anchor_answer();


-- ---------------------------------------------------------------------
-- 8. update_transfer(): each leg carries its own answer
--
-- A transfer's two legs sit on two accounts with two anchors, so each
-- leg is asked about separately. The from-answer goes on the Expense leg,
-- the to-answer on the Income leg, following the accounts through a swap.
-- Otherwise unchanged from migration 59.
-- ---------------------------------------------------------------------
drop function public.update_transfer(uuid, uuid, uuid, numeric, date, text, text, boolean);

create function public.update_transfer(
  p_transfer_group_id          uuid,
  p_from_accountid             uuid,
  p_to_accountid               uuid,
  p_amount                     numeric,
  p_transaction_date           date,
  p_description                text,
  p_notes                      text default null,
  p_update_schedule            boolean default false,
  p_from_counts_despite_anchor boolean default null,
  p_from_anchor_answer_set_at  timestamptz default null,
  p_to_counts_despite_anchor   boolean default null,
  p_to_anchor_answer_set_at    timestamptz default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_legs        int;
  v_recurringid uuid;
begin
  if v_uid is null then
    raise exception 'update_transfer: no authenticated user';
  end if;
  if p_from_accountid is null or p_to_accountid is null or p_from_accountid = p_to_accountid then
    raise exception 'Choose two different accounts for a transfer.' using errcode = '23514';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = '23514';
  end if;
  if p_transaction_date is null or coalesce(btrim(p_description), '') = '' then
    raise exception 'A transfer needs a date and a description.' using errcode = '23514';
  end if;

  -- Both accounts are the caller's. Another user's account looks the same
  -- as a missing one.
  if (select count(*) from public.accounts
       where id in (p_from_accountid, p_to_accountid) and userid = v_uid) <> 2 then
    raise exception 'update_transfer: account not found' using errcode = 'P0002';
  end if;

  -- Exactly the caller's pair: one Expense leg, one Income leg.
  select count(*), max(recurringid::text)::uuid
    into v_legs, v_recurringid
    from public.transactions
   where transfer_group_id = p_transfer_group_id and userid = v_uid;
  if v_legs <> 2
     or (select count(distinct transaction_type) from public.transactions
          where transfer_group_id = p_transfer_group_id and userid = v_uid) <> 2 then
    raise exception 'update_transfer: transfer not found' using errcode = 'P0002';
  end if;

  perform set_config('sorrel.transfer_edit', 'on', true);

  -- The Expense leg is the source and the Income leg the destination, so
  -- swapping the accounts swaps the direction and the pair stays correct.
  -- Each leg's anchor answer follows its account.
  update public.transactions
     set accountid = case transaction_type when 'Expense' then p_from_accountid else p_to_accountid end,
         amount = p_amount,
         transaction_date = p_transaction_date,
         description = btrim(p_description),
         notes = nullif(btrim(coalesce(p_notes, '')), ''),
         counts_despite_anchor = case transaction_type when 'Expense'
                                   then p_from_counts_despite_anchor else p_to_counts_despite_anchor end,
         anchor_answer_set_at  = case transaction_type when 'Expense'
                                   then p_from_anchor_answer_set_at else p_to_anchor_answer_set_at end
   where transfer_group_id = p_transfer_group_id and userid = v_uid;

  -- "This and future occurrences": the schedule expects the new amount.
  if p_update_schedule and v_recurringid is not null then
    update public.recurring_transactions
       set amount = p_amount
     where id = v_recurringid and userid = v_uid;
  end if;

  perform set_config('sorrel.transfer_edit', '', true);
end;
$$;

comment on function public.update_transfer(uuid, uuid, uuid, numeric, date, text, text, boolean, boolean, timestamptz, boolean, timestamptz) is
  'The only write path for an existing transfer: both legs in one call, so they can''t disagree. From/to/amount/date/description/notes; swapping from and to swaps direction. p_update_schedule also sets the schedule''s amount ("this and future occurrences"). Each leg carries its own pre-anchor answer (p_from_* on the Expense leg, p_to_* on the Income leg; migration 62). SECURITY DEFINER, scoped to auth.uid() (migration 59).';

revoke all on function public.update_transfer(uuid, uuid, uuid, numeric, date, text, text, boolean, boolean, timestamptz, boolean, timestamptz) from public, anon;
grant execute on function public.update_transfer(uuid, uuid, uuid, numeric, date, text, text, boolean, boolean, timestamptz, boolean, timestamptz) to authenticated;
