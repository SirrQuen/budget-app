-- =====================================================================
-- Sorrel 68: import transactions from a CSV file
-- (docs/Import-CSV.md)
--
-- The file is read in the browser and never reaches the server. What
-- reaches the database is only the rows a person confirmed in the
-- preview, in ONE call, and one call is one transaction: all rows or
-- none. A forced failure on row 70 of 140 leaves zero rows.
--
--   imports                 one row per import: the batch an "Undo this
--                           import" acts on. No filename, ever -- a
--                           bank's filename can carry an account number.
--   transactions.import_id  the batch a row came from. Composite FK,
--                           ON DELETE RESTRICT: deleting an import row
--                           can never silently delete transactions. Undo
--                           deletes the transactions explicitly, then
--                           the import.
--
--   import_preview()        the preview's balance change. Takes the
--                           account and the DISTINCT DATES of the file --
--                           no descriptions, no amounts -- and says, per
--                           date, how counts_in_balance() treats a row on
--                           it: counts, before the anchor (depends on the
--                           one answer the person gives for the batch),
--                           or future. The browser applies the answer and
--                           sums integer cents. The rule stays here only.
--   import_transactions()   the atomic insert. Writes the pre-anchor
--                           answer to every row exactly as if each had
--                           been answered one at a time, so
--                           trg_transactions_anchor_answer passes (or
--                           refuses the whole batch, SRA01/SRA02). A row
--                           the person answered "Yes, same bill" is
--                           linked and its schedule stepped past the
--                           occurrence IN THE SAME TRANSACTION; a "No" is
--                           recorded as item 4 records it. Any failure
--                           leaves no row, no link, no cursor move.
--   undo_import()           one atomic undo: deletes the batch's
--                           transactions (the delete trigger of
--                           migration 66 puts a "same bill" occurrence
--                           back), then the import row.
--   list_imports()          Settings > Import: each import with how many
--                           of its rows are left and how many were edited.
--
-- Also here: item 4's "Yes" is split in two so import can reuse it for a
-- PAST-dated row without a second copy of the logic.
-- same_bill_answer() is confirm_same_bill()'s body with the "entry is
-- dated ahead" check made a parameter; confirm_same_bill() calls it with
-- the check on, so its behaviour is unchanged (docs/same-bill-test.sql
-- must still pass). Import calls it with the check off.
--
-- The privacy policy changes with this feature ("typed in yourself" is no
-- longer true), so testers are emailed before it deploys.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. same_bill_answer(): item 4's "Yes", the date check a parameter
--
-- Body identical to confirm_same_bill() in migration 66 except
-- p_require_ahead. Callable only by other SECURITY DEFINER functions
-- (owner), never directly: it carries no check of its own that a caller
-- passed the right flag.
-- ---------------------------------------------------------------------
create function public.same_bill_answer(
  p_transaction_id uuid,
  p_recurring_id   uuid,
  p_from_run_date  date,
  p_to_run_date    date,
  p_to_due_date    date,
  p_require_ahead  boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_sched public.recurring_transactions%rowtype;
  v_tx    public.transactions%rowtype;
begin
  if v_uid is null then
    raise exception 'same_bill_answer: no authenticated user';
  end if;
  if p_to_run_date is null or p_to_due_date is null or p_to_run_date <= p_from_run_date then
    raise exception 'same_bill_answer: the next cycle must come after this one' using errcode = '22023';
  end if;

  select * into v_sched
    from public.recurring_transactions
   where id = p_recurring_id and userid = v_uid
     for update;
  if not found then
    raise exception 'same_bill_answer: schedule not found' using errcode = 'P0002';
  end if;

  select * into v_tx
    from public.transactions
   where id = p_transaction_id and userid = v_uid;
  if not found then
    raise exception 'same_bill_answer: transaction not found' using errcode = 'P0002';
  end if;
  -- A transfer is answered through its Expense leg.
  if v_tx.transfer_group_id is not null and v_tx.transaction_type <> 'Expense' then
    select * into v_tx
      from public.transactions
     where transfer_group_id = v_tx.transfer_group_id and transaction_type = 'Expense' and userid = v_uid;
    if not found then
      raise exception 'same_bill_answer: transaction not found' using errcode = 'P0002';
    end if;
  end if;

  -- The claim, as every queue answer makes it: only while the cursor is
  -- still the occurrence the question showed.
  if v_sched.next_run_date is distinct from p_from_run_date then
    return 'already_answered';
  end if;
  -- A hand-entered entry must be dated ahead -- one the forecast counts on
  -- its own date. An imported row is already in the past, and the schedule's
  -- occurrence is waiting in the confirmation queue instead.
  if p_require_ahead and v_tx.transaction_date <= current_date then
    return 'not_ahead';
  end if;

  if not public.link_transaction_to_schedule(v_tx.id, p_recurring_id) then
    return 'not_linkable';
  end if;

  insert into public.same_bill_answers
    (userid, recurringid, transactionid, answer, occurrence_due_date,
     occurrence_run_date, advanced_to_run_date, prior_next_amount, prior_next_amount_confirmed_at)
  values
    (v_uid, p_recurring_id, v_tx.id, 'same', v_sched.next_due_date,
     v_sched.next_run_date, p_to_run_date, v_sched.next_amount, v_sched.next_amount_confirmed_at)
  on conflict (recurringid, transactionid) do update
     set answer                         = 'same',
         occurrence_due_date            = excluded.occurrence_due_date,
         occurrence_run_date            = excluded.occurrence_run_date,
         advanced_to_run_date           = excluded.advanced_to_run_date,
         prior_next_amount              = excluded.prior_next_amount,
         prior_next_amount_confirmed_at = excluded.prior_next_amount_confirmed_at,
         created_at                     = now();

  -- A staged statement amount belongs to the cycle just filled, so it
  -- clears -- as it does when any answer moves the cursor.
  update public.recurring_transactions
     set next_run_date            = p_to_run_date,
         next_due_date            = p_to_due_date,
         next_amount              = null,
         next_amount_confirmed_at = null
   where id = p_recurring_id and userid = v_uid;

  return 'answered';
end;
$$;

comment on function public.same_bill_answer(uuid, uuid, date, date, date, boolean) is
  'The "Yes, they''re the same" write: links the transaction to the schedule (link_transaction_to_schedule) and steps the schedule past the occurrence it fills, recording the step in same_bill_answers so deleting the transaction can undo it. p_require_ahead = true is item 4 (a hand-entered entry dated after today, via confirm_same_bill); false is import (a past-dated row against an occurrence in the confirmation queue, via import_transactions). Returns answered | already_answered | not_ahead | not_linkable. Internal: SECURITY DEFINER functions only (migration 68; body from migration 66).';

revoke all on function public.same_bill_answer(uuid, uuid, date, date, date, boolean) from public, anon, authenticated;

-- confirm_same_bill(): the same signature, now one call to the core with
-- the date check on. create or replace keeps its grants.
create or replace function public.confirm_same_bill(
  p_transaction_id uuid,
  p_recurring_id   uuid,
  p_from_run_date  date,
  p_to_run_date    date,
  p_to_due_date    date
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.same_bill_answer(p_transaction_id, p_recurring_id, p_from_run_date,
                                 p_to_run_date, p_to_due_date, true);
end;
$$;

comment on function public.confirm_same_bill(uuid, uuid, date, date, date) is
  '"Yes, they''re the same": links a future-dated entry to the schedule (link_transaction_to_schedule) and steps the schedule past the occurrence it fills, recording the step in same_bill_answers so deleting the entry can undo it. Claims on p_from_run_date like every queue answer. Returns answered | already_answered | not_ahead | not_linkable. Calls same_bill_answer() with the "dated ahead" check on (migration 68; migration 66). SECURITY DEFINER, scoped to auth.uid().';


-- ---------------------------------------------------------------------
-- 2. imports
-- ---------------------------------------------------------------------
create table public.imports (
  id              uuid primary key default gen_random_uuid(),
  userid          uuid not null references public.profiles(id) on delete cascade,
  accountid       uuid not null,
  row_count       integer not null,
  -- A retry of an import that already went through finds it instead of
  -- writing it twice. Null for none.
  idempotency_key uuid,
  created_at      timestamptz not null default now(),
  constraint imports_row_count_range check (row_count between 1 and 5000),
  constraint imports_userid_id_key unique (userid, id),
  constraint imports_userid_idempotency_key_key unique (userid, idempotency_key),
  constraint imports_accountid_fkey
    foreign key (userid, accountid) references public.accounts(userid, id) on delete restrict
);

create index idx_imports_userid on public.imports using btree (userid);
create index idx_imports_accountid on public.imports using btree (accountid);

comment on table public.imports is
  'One row per CSV import: the batch "Undo this import" acts on. Holds no filename and no row content -- a bank''s filename can carry an account number, and the file itself never leaves the person''s device. Written only by import_transactions(), deleted only by undo_import() (migration 68).';
comment on column public.imports.row_count is
  'How many transactions the import wrote. Between 1 and 5,000 (the server-side limit). Rows deleted since are not subtracted: list_imports() reports what remains.';

alter table public.imports enable row level security;

create policy imports_select_own on public.imports
  for select to authenticated using (userid = (select auth.uid()));

-- A new table picks up the project's default privileges, and those differ
-- between our projects (CLAUDE.md, migration 57's grant block). Revoke
-- from all four roles, then grant exactly what's used: authenticated
-- reads its own rows (the functions below write them); service_role
-- carries what every baseline table gives it -- nothing that reads or
-- writes rows.
revoke all on table public.imports from public, anon, authenticated, service_role;
grant select on table public.imports to authenticated;
grant references, trigger, truncate, maintain on table public.imports to service_role;


-- ---------------------------------------------------------------------
-- 3. transactions.import_id -- RESTRICT, never CASCADE
-- ---------------------------------------------------------------------
alter table public.transactions
  add column import_id uuid;

alter table public.transactions
  add constraint transactions_import_fkey
  foreign key (userid, import_id) references public.imports(userid, id) on delete restrict;

create index idx_transactions_import_id on public.transactions using btree (import_id) where import_id is not null;

comment on column public.transactions.import_id is
  'The import this row came from, or null for anything entered another way. ON DELETE RESTRICT: removing an import row can never silently remove transactions -- undo_import() deletes them explicitly first (migration 68).';


-- ---------------------------------------------------------------------
-- 4. delete_own_account(): imports go before the accounts they name
-- ---------------------------------------------------------------------
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'delete_own_account: no authenticated user';
  end if;

  -- children -> parents, so no ON DELETE RESTRICT FK is ever checked with
  -- its referencing rows still present (see 14 for the full reasoning).
  delete from public.goal_contributions
   where goalid in (select id from public.goals where userid = v_uid);

  delete from public.transactions            where userid = v_uid;
  delete from public.imports                 where userid = v_uid;
  delete from public.recurring_transactions  where userid = v_uid;
  delete from public.investments             where userid = v_uid;
  delete from public.budgets                 where userid = v_uid;
  delete from public.goals                   where userid = v_uid;
  delete from public.accounts                where userid = v_uid;
  delete from public.categories              where userid = v_uid;
  delete from public.category_groups         where userid = v_uid;
  delete from public.notifications           where userid = v_uid;
  delete from public.settings                where userid = v_uid;
  delete from public.subscriptions           where userid = v_uid;

  -- PKCE flow scratch rows -- no FK to auth.users, so not covered by the
  -- cascade below.
  delete from auth.flow_state where user_id = v_uid;

  -- The account itself. `id = v_uid` only -- never a passed-in id. Cascades
  -- to public.profiles (childless by now) and to auth.identities /
  -- auth.sessions / auth.one_time_tokens / auth.mfa_factors / the rest.
  delete from auth.users where id = v_uid;
end;
$$;

comment on function public.delete_own_account() is
  'Permanently deletes the calling user (auth.uid()): every owned row in public.*, their auth.flow_state rows, then their auth.users row, which cascades to profiles and the rest of auth.*. Irreversible, no backup. Takes no argument by design -- a caller can only delete themselves. Imports are deleted after the transactions that reference them and before the accounts they name (migration 68).';


-- ---------------------------------------------------------------------
-- 5. import_preview(): how the balance rule treats each date
--
-- security invoker: RLS scopes the account lookup, so another user's
-- account looks like a missing one (P0002). Reads nothing but the
-- account's anchor; nothing about the file beyond its dates.
-- ---------------------------------------------------------------------
create function public.import_preview(
  p_accountid uuid,
  p_dates     date[]
)
returns table (
  transaction_date  date,
  -- counts        counts in the balance now, whatever the answer
  -- before_anchor dated before the balance date: counts only if the person
  --               answers "No, add them to my balance"
  -- future        dated after today: counts on its date, not yet
  treatment         text,
  counts_if_included boolean,  -- the answer "Yes, already counted"
  counts_if_added    boolean   -- the answer "No, add them to my balance"
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_acct public.accounts%rowtype;
begin
  select * into v_acct from public.accounts where id = p_accountid;
  if not found then
    raise exception 'import_preview: account not found' using errcode = 'P0002';
  end if;
  if coalesce(cardinality(p_dates), 0) > 5000 then
    raise exception 'import_preview: too many dates' using errcode = '22023';
  end if;

  return query
  select d.d,
         case
           when public.counts_in_balance(d.d, now(), v_acct.opening_date, v_acct.opening_set_at,
                                         null, null, current_date) then 'counts'
           when public.anchor_includes(d.d, now(), v_acct.opening_date, v_acct.opening_set_at,
                                       null, null) then 'future'
           else 'before_anchor'
         end,
         public.counts_in_balance(d.d, now(), v_acct.opening_date, v_acct.opening_set_at,
                                  false, v_acct.opening_set_at, current_date),
         public.counts_in_balance(d.d, now(), v_acct.opening_date, v_acct.opening_set_at,
                                  true, v_acct.opening_set_at, current_date)
    from (select distinct u.d from unnest(p_dates) as u(d) where u.d is not null) d
   order by d.d;
end;
$$;

comment on function public.import_preview(uuid, date[]) is
  'For the import preview: per distinct date, how a row dated then is treated by counts_in_balance() on this account -- counts / before_anchor (depends on the one answer for the batch) / future -- and whether it counts under each answer. Takes dates only: no descriptions, no amounts. The browser applies the answer and sums integer cents; the rule stays here (migration 68).';

revoke all on function public.import_preview(uuid, date[]) from public, anon;
grant execute on function public.import_preview(uuid, date[]) to authenticated;


-- ---------------------------------------------------------------------
-- 6. import_transactions(): the atomic insert
--
-- p_rows is a jsonb array, one object per confirmed row:
--   row           the row's number in the file (for an error message only)
--   date          'YYYY-MM-DD'
--   cents         integer > 0 -- never a float, never dollars
--   type          'Income' | 'Expense'
--   description   text, required
--   notes, merchant, payment_method   text, optional
--   categoryid    uuid, optional (the person's own; the composite FK
--                 rejects anyone else's)
--   is_estimated  boolean, optional (a Sorrel export carries it back)
--   same_bill     {recurringid, from_run_date, to_run_date, to_due_date}
--                 optional: "Yes, same bill" -- link and step the cursor
--   different_bill {recurringid, due_date}
--                 optional: "No, keep both" -- remembered
--
-- p_counts_despite_anchor is the ONE pre-anchor answer for the batch:
-- true = "No, add them to my balance", false = "Yes, already counted",
-- null = not asked. It is written to every row; the anchor trigger clears
-- it on a row the date rule already counts and refuses the batch (SRA01)
-- when a row needs an answer and there is none.
--
-- All of it is one transaction. Server-side limits: 5,000 rows, text
-- lengths, dates 1970 to a year ahead, amounts that fit numeric(12,2).
-- Every error names a row number at most, never its content.
-- ---------------------------------------------------------------------
create function public.import_transactions(
  p_accountid             uuid,
  p_rows                  jsonb,
  p_counts_despite_anchor boolean default null,
  p_idempotency_key       uuid    default null
)
returns table (out_import_id uuid, out_row_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_acct    public.accounts%rowtype;
  v_import  uuid;
  v_n       integer;
  v_e       record;
  v_row     jsonb;
  v_ref     text;
  v_date    date;
  v_cents   bigint;
  v_type    text;
  v_desc    text;
  v_notes   text;
  v_merch   text;
  v_pay     text;
  v_cat     uuid;
  v_est     boolean;
  v_tx      uuid;
  v_same    jsonb;
  v_diff    jsonb;
  v_res     text;
begin
  if v_uid is null then
    raise exception 'import_transactions: no authenticated user';
  end if;

  -- A retry of an import that already went through.
  if p_idempotency_key is not null then
    select i.id, i.row_count into v_import, v_n
      from public.imports i
     where i.userid = v_uid and i.idempotency_key = p_idempotency_key;
    if found then
      return query select v_import, v_n;
      return;
    end if;
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'import_transactions: rows must be an array' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_rows);
  if v_n < 1 then
    raise exception 'There is nothing to import.' using errcode = '22023';
  end if;
  if v_n > 5000 then
    raise exception 'An import can have at most 5,000 transactions. Split the file and import it in parts.'
      using errcode = '22023';
  end if;

  -- The caller's own, active account. Another user's looks like a missing one.
  select * into v_acct
    from public.accounts
   where id = p_accountid and userid = v_uid;
  if not found then
    raise exception 'import_transactions: account not found' using errcode = 'P0002';
  end if;
  if not v_acct.is_active then
    raise exception 'This account is archived, so nothing can be imported into it.' using errcode = '23514';
  end if;

  insert into public.imports (userid, accountid, row_count, idempotency_key)
  values (v_uid, p_accountid, v_n, p_idempotency_key)
  returning id into v_import;

  for v_e in
    select e.value as val, e.ordinality::integer as pos
      from jsonb_array_elements(p_rows) with ordinality as e(value, ordinality)
  loop
    v_row := v_e.val;
    v_ref := coalesce(nullif(v_row ->> 'row', ''), v_e.pos::text);

    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'Row % could not be imported: it is not a row.', v_ref using errcode = '22023';
    end if;

    -- date
    if coalesce(v_row ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Row % could not be imported: its date is not a date.', v_ref using errcode = '22007';
    end if;
    v_date := (v_row ->> 'date')::date;
    if v_date < date '1970-01-01' or v_date > current_date + 365 then
      raise exception 'Row % could not be imported: its date is out of range.', v_ref using errcode = '22008';
    end if;

    -- amount: integer cents, 1 .. what numeric(12,2) holds
    if coalesce(v_row ->> 'cents', '') !~ '^\d{1,12}$' then
      raise exception 'Row % could not be imported: its amount is not a whole number of cents.', v_ref using errcode = '22003';
    end if;
    v_cents := (v_row ->> 'cents')::bigint;
    if v_cents < 1 then
      raise exception 'Row % could not be imported: its amount is zero.', v_ref using errcode = '22003';
    end if;

    -- direction
    v_type := v_row ->> 'type';
    if v_type is null or v_type not in ('Income', 'Expense') then
      raise exception 'Row % could not be imported: its type is neither Income nor Expense.', v_ref using errcode = '22023';
    end if;

    -- text, with caps
    v_desc  := btrim(coalesce(v_row ->> 'description', ''));
    v_notes := nullif(btrim(coalesce(v_row ->> 'notes', '')), '');
    v_merch := nullif(btrim(coalesce(v_row ->> 'merchant', '')), '');
    v_pay   := nullif(btrim(coalesce(v_row ->> 'payment_method', '')), '');
    if v_desc = '' or char_length(v_desc) > 500 then
      raise exception 'Row % could not be imported: its description is empty or too long.', v_ref using errcode = '22001';
    end if;
    if char_length(coalesce(v_notes, '')) > 2000 or char_length(coalesce(v_merch, '')) > 500
       or char_length(coalesce(v_pay, '')) > 100 then
      raise exception 'Row % could not be imported: a text field is too long.', v_ref using errcode = '22001';
    end if;

    -- category: the person's own, by the composite FK; a missing one is null
    v_cat := null;
    if coalesce(v_row ->> 'categoryid', '') <> '' then
      if v_row ->> 'categoryid' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Row % could not be imported: its category is not valid.', v_ref using errcode = '22P02';
      end if;
      v_cat := (v_row ->> 'categoryid')::uuid;
    end if;

    v_est := coalesce((v_row ->> 'is_estimated')::boolean, false);

    insert into public.transactions
      (userid, accountid, categoryid, transaction_date, description, merchant, amount,
       transaction_type, notes, payment_method, is_estimated,
       counts_despite_anchor, anchor_answer_set_at, import_id)
    values
      (v_uid, p_accountid, v_cat, v_date, v_desc, v_merch, v_cents::numeric / 100,
       v_type, v_notes, v_pay, v_est,
       p_counts_despite_anchor,
       case when p_counts_despite_anchor is null then null else v_acct.opening_set_at end,
       v_import)
    returning id into v_tx;

    -- "Yes, same bill": link it, step the schedule past the occurrence, and
    -- record the step -- the whole of item 4's answer, inside this call.
    v_same := v_row -> 'same_bill';
    if v_same is not null and jsonb_typeof(v_same) = 'object' then
      v_res := public.same_bill_answer(
        v_tx,
        (v_same ->> 'recurringid')::uuid,
        (v_same ->> 'from_run_date')::date,
        (v_same ->> 'to_run_date')::date,
        (v_same ->> 'to_due_date')::date,
        false);
      if v_res <> 'answered' then
        raise exception 'Row % could not be matched to its schedule (%). Nothing was imported.', v_ref, v_res
          using errcode = 'SIM01';
      end if;
    end if;

    -- "No, keep both": remembered, as item 4 remembers it.
    v_diff := v_row -> 'different_bill';
    if v_diff is not null and jsonb_typeof(v_diff) = 'object' then
      perform public.record_different_bill(
        v_tx,
        (v_diff ->> 'recurringid')::uuid,
        (v_diff ->> 'due_date')::date);
    end if;
  end loop;

  return query select v_import, v_n;
end;
$$;

comment on function public.import_transactions(uuid, jsonb, boolean, uuid) is
  'The one write path for a CSV import: inserts every confirmed row, the batch''s single pre-anchor answer on each, and each "same bill" answer (link + step the schedule + record) -- in one transaction, so all of it or none of it. Scoped to auth.uid(); another user''s account is refused (P0002). At most 5,000 rows; every field validated again here; errors name a row number, never its content. A retry with the same p_idempotency_key returns the import already written. SECURITY DEFINER (migration 68).';

revoke all on function public.import_transactions(uuid, jsonb, boolean, uuid) from public, anon;
grant execute on function public.import_transactions(uuid, jsonb, boolean, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 7. undo_import(): one atomic undo
--
-- Deletes the batch's transactions, then the import. Newest "same bill"
-- answer first, so the delete trigger of migration 66 puts each schedule
-- back where it was in reverse order. A row the person has since edited
-- goes too -- the confirmation says how many (list_imports()).
-- ---------------------------------------------------------------------
create function public.undo_import(p_import_id uuid)
returns table (out_deleted integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_deleted integer := 0;
  v_r       record;
begin
  if v_uid is null then
    raise exception 'undo_import: no authenticated user';
  end if;
  if not exists (select 1 from public.imports where id = p_import_id and userid = v_uid) then
    raise exception 'undo_import: import not found' using errcode = 'P0002';
  end if;

  for v_r in
    select t.id
      from public.transactions t
     where t.import_id = p_import_id and t.userid = v_uid
     order by (select max(a.created_at) from public.same_bill_answers a where a.transactionid = t.id) desc nulls last,
              t.id
  loop
    delete from public.transactions where id = v_r.id and userid = v_uid;
    v_deleted := v_deleted + 1;
  end loop;

  delete from public.imports where id = p_import_id and userid = v_uid;

  return query select v_deleted;
end;
$$;

comment on function public.undo_import(uuid) is
  'Undoes one import atomically: deletes every transaction still carrying its import_id (an occurrence a row was matched to comes back through trg_transactions_restore_same_bill, newest answer first), then the import row. Scoped to auth.uid(); another user''s import is refused (P0002). SECURITY DEFINER (migration 68).';

revoke all on function public.undo_import(uuid) from public, anon;
grant execute on function public.undo_import(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 8. list_imports(): Settings > Import
-- ---------------------------------------------------------------------
create function public.list_imports()
returns table (
  import_id       uuid,
  accountid       uuid,
  account_name    text,
  created_at      timestamptz,
  row_count       integer,
  remaining_count integer,
  -- rows changed since the import wrote them (updated_at moved)
  edited_count    integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.id, i.accountid, a.account_name, i.created_at, i.row_count,
         count(t.id)::integer,
         (count(t.id) filter (where t.updated_at > t.created_at))::integer
    from public.imports i
    join public.accounts a on a.id = i.accountid
    left join public.transactions t on t.import_id = i.id
   group by i.id, a.account_name
   order by i.created_at desc, i.id
$$;

comment on function public.list_imports() is
  'The caller''s imports, newest first: date, account, how many rows it wrote, how many of those remain, and how many were edited since (updated_at past created_at) -- the confirmation before "Undo this import" says so. security invoker: RLS scopes it (migration 68).';

revoke all on function public.list_imports() from public, anon;
grant execute on function public.list_imports() to authenticated;
