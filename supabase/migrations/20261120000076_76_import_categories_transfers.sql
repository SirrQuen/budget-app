-- =====================================================================
-- Sorrel 76: import -- transfers, and a category per row
-- (docs/Import-CSV.md, "Transfers"; docs/phase-7-findings.md, "Import:
-- transfers came in as spending")
--
-- A checking -> savings transfer in a bank file came in as an Expense:
-- Spendable Cash fell, savings didn't rise, and a card payment was counted
-- twice (once leaving checking, again as the card balance owed). A file
-- row can now be a TRANSFER, written one of two ways inside the import's
-- one transaction:
--
--   create   both legs, inserted here, inline -- the batch's second
--            transfer insert path beside createTransfer() (CLAUDE.md).
--            Both legs carry the import, so undo removes both. The other
--            leg is asked the pre-anchor question against ITS OWN
--            account's balance date.
--   pair     the other side is already on the other account (typed by
--            hand, or from an earlier import): that plain row becomes the
--            other leg. Only plain rows -- not a leg, no schedule, no
--            same-bill answer, no goal if it becomes the Income leg.
--            Its date, amount and account don't change, so its own
--            pre-anchor answer stands and nothing re-asks it. What it
--            was is kept in import_pairings, so undo restores it.
--
--   import_pairings         one row per existing transaction an import
--                           made into a transfer leg: its category before.
--                           Cascades from the transaction (delete the
--                           transfer and there's nothing to restore);
--                           RESTRICT from the import (undo restores first).
--   import_transactions()   row.transfer = {other_accountid, pair_with,
--                           counts_despite_anchor}. Signature unchanged
--                           (p_rows is jsonb), so its grants stand. Also
--                           refuses an archived category, another user's,
--                           or one of the wrong type with a row-numbered
--                           message instead of the generic error.
--   undo_import()           refuses while a LATER import paired one of its
--                           rows (SIU01, names that import's date); else
--                           restores its pairings, then deletes its rows.
--   list_imports()          counts occurrences, not rows: a transfer's two
--                           legs are one (CLAUDE.md, "counts distinct
--                           coalesce(transfer_group_id, id)").
--   delete_own_account()    import_pairings goes first.
--
-- No new index: the other-accounts read in the preview is (accountid,
-- transaction_date), covered by idx_tx_account_date; under RLS also
-- idx_tx_user_date.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. import_pairings
-- ---------------------------------------------------------------------
create table public.import_pairings (
  id                uuid primary key default gen_random_uuid(),
  userid            uuid not null references public.profiles(id) on delete cascade,
  import_id         uuid not null,
  transactionid     uuid not null,
  -- What the row was in before it became a leg. Non-null: only a plain,
  -- categorised row can be paired (transactions_category_required).
  prior_categoryid  uuid not null,
  transfer_group_id uuid not null,
  created_at        timestamptz not null default now(),
  constraint import_pairings_transactionid_key unique (transactionid),
  constraint import_pairings_import_fkey
    foreign key (userid, import_id) references public.imports(userid, id) on delete restrict,
  constraint import_pairings_transaction_fkey
    foreign key (userid, transactionid) references public.transactions(userid, id) on delete cascade,
  constraint import_pairings_prior_category_fkey
    foreign key (userid, prior_categoryid) references public.categories(userid, id) on delete restrict
);

create index idx_import_pairings_import_id on public.import_pairings using btree (import_id);
create index idx_import_pairings_userid on public.import_pairings using btree (userid);

comment on table public.import_pairings is
  'One row per existing transaction an import made into a transfer leg: the category it had before, so "Undo this import" puts it back exactly. Written only by import_transactions(), read and deleted by undo_import(); cascades when the transaction is deleted (migration 76).';

alter table public.import_pairings enable row level security;

create policy import_pairings_select_own on public.import_pairings
  for select to authenticated using (userid = (select auth.uid()));

-- Migration 68's grant block: revoke from all four roles, then grant
-- exactly what's used. authenticated reads its own (the undo preview);
-- the functions below write.
revoke all on table public.import_pairings from public, anon, authenticated, service_role;
grant select on table public.import_pairings to authenticated;
grant references, trigger, truncate, maintain on table public.import_pairings to service_role;


-- ---------------------------------------------------------------------
-- 2. delete_own_account(): import_pairings before the transactions
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

  delete from public.import_pairings         where userid = v_uid;
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
  'Permanently deletes the calling user (auth.uid()): every owned row in public.*, their auth.flow_state rows, then their auth.users row, which cascades to profiles and the rest of auth.*. Irreversible, no backup. Takes no argument by design -- a caller can only delete themselves. Import pairings go first, then transactions, then imports, before the accounts they name (migrations 68, 76).';


-- ---------------------------------------------------------------------
-- 3. import_transactions(): transfers, and the category checked by row
--
-- p_rows, one object per confirmed file row -- as migration 68, plus:
--   transfer   {other_accountid, pair_with, counts_despite_anchor}
--              optional. The row is a transfer between the import's
--              account and other_accountid; its own `type` says which way
--              (Expense: money left this account, so this is the source).
--              No categoryid. pair_with: an existing plain row on the
--              other account to make the other leg, else both legs are
--              created. counts_despite_anchor: the other account's
--              pre-anchor answer, for a created leg (null = not asked).
--
-- A transfer row may carry same_bill or different_bill only when it
-- creates both legs: a joined row can't also take a schedule's
-- occurrence in v1 (the existing row isn't the import's to step a
-- schedule over).
-- ---------------------------------------------------------------------
create or replace function public.import_transactions(
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
  v_other   public.accounts%rowtype;
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
  v_cat_row public.categories%rowtype;
  v_est     boolean;
  v_tx      uuid;
  v_same    jsonb;
  v_diff    jsonb;
  v_res     text;
  v_xfer    jsonb;
  v_group   uuid;
  v_pair    uuid;
  v_pair_tx public.transactions%rowtype;
  v_oanswer boolean;
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

    v_xfer := v_row -> 'transfer';
    if v_xfer is not null and jsonb_typeof(v_xfer) = 'null' then
      v_xfer := null;
    end if;
    if v_xfer is not null and jsonb_typeof(v_xfer) <> 'object' then
      raise exception 'Row % could not be imported: its transfer is not valid.', v_ref using errcode = '22023';
    end if;

    -- category: the person's own, active, of the row's type -- said by row
    -- number here rather than left to the FK and the type trigger, whose
    -- errors reach the person only as the generic one. A transfer has none.
    v_cat := null;
    if coalesce(v_row ->> 'categoryid', '') <> '' then
      if v_xfer is not null then
        raise exception 'Row % could not be imported: a transfer has no category.', v_ref using errcode = '23514';
      end if;
      if v_row ->> 'categoryid' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Row % could not be imported: its category is not valid.', v_ref using errcode = '22P02';
      end if;
      v_cat := (v_row ->> 'categoryid')::uuid;
      select * into v_cat_row from public.categories where id = v_cat and userid = v_uid;
      if not found then
        raise exception 'Row % could not be imported: its category is not one of yours.', v_ref using errcode = '23503';
      end if;
      if not v_cat_row.is_active then
        raise exception 'Row % could not be imported: its category is archived. Choose another.', v_ref using errcode = '23514';
      end if;
      if v_cat_row.category_type <> v_type then
        raise exception 'Row % could not be imported: its category is for %.', v_ref,
          case v_cat_row.category_type when 'Income' then 'income' else 'spending' end
          using errcode = '23514';
      end if;
    end if;

    v_est := coalesce((v_row ->> 'is_estimated')::boolean, false);

    v_same := v_row -> 'same_bill';
    if v_same is not null and jsonb_typeof(v_same) <> 'object' then v_same := null; end if;
    v_diff := v_row -> 'different_bill';
    if v_diff is not null and jsonb_typeof(v_diff) <> 'object' then v_diff := null; end if;

    if v_xfer is null then
      -- A plain row, as migration 68.
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
    else
      -- A transfer. The other account: the caller's own, active, not this one.
      if coalesce(v_xfer ->> 'other_accountid', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Row % could not be imported: its transfer has no other account.', v_ref using errcode = '22023';
      end if;
      select * into v_other
        from public.accounts
       where id = (v_xfer ->> 'other_accountid')::uuid and userid = v_uid;
      if not found then
        raise exception 'Row % could not be imported: its transfer''s other account isn''t one of yours.', v_ref using errcode = 'P0002';
      end if;
      if v_other.id = p_accountid then
        raise exception 'Row % could not be imported: a transfer needs two different accounts.', v_ref using errcode = '23514';
      end if;
      if not v_other.is_active then
        raise exception 'Row % could not be imported: its transfer''s other account is archived.', v_ref using errcode = '23514';
      end if;

      v_pair := null;
      if coalesce(v_xfer ->> 'pair_with', '') <> '' then
        if v_xfer ->> 'pair_with' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          raise exception 'Row % could not be imported: its transfer is not valid.', v_ref using errcode = '22023';
        end if;
        v_pair := (v_xfer ->> 'pair_with')::uuid;
      end if;
      v_oanswer := (v_xfer ->> 'counts_despite_anchor')::boolean;

      v_group := gen_random_uuid();

      -- This account's leg. Its type is the row's; the anchor answer is the batch's.
      insert into public.transactions
        (userid, accountid, categoryid, transaction_date, description, merchant, amount,
         transaction_type, notes, payment_method, is_estimated, transfer_group_id,
         counts_despite_anchor, anchor_answer_set_at, import_id)
      values
        (v_uid, p_accountid, null, v_date, v_desc, v_merch, v_cents::numeric / 100,
         v_type, v_notes, v_pay, v_est, v_group,
         p_counts_despite_anchor,
         case when p_counts_despite_anchor is null then null else v_acct.opening_set_at end,
         v_import)
      returning id into v_tx;

      if v_pair is null then
        -- Create the other leg: opposite type, the other account's own answer.
        insert into public.transactions
          (userid, accountid, categoryid, transaction_date, description, amount,
           transaction_type, notes, is_estimated, transfer_group_id,
           counts_despite_anchor, anchor_answer_set_at, import_id)
        values
          (v_uid, v_other.id, null, v_date, v_desc, v_cents::numeric / 100,
           case v_type when 'Expense' then 'Income' else 'Expense' end, v_notes, v_est, v_group,
           v_oanswer,
           case when v_oanswer is null then null else v_other.opening_set_at end,
           v_import);
      else
        -- Pair: the existing row becomes the other leg. Re-checked here
        -- against what the database holds now, locked so two rows (or two
        -- imports) can't both claim it.
        if v_same is not null or v_diff is not null then
          raise exception 'Row % could not be imported: a transfer joined to an existing entry can''t also be matched to a schedule.', v_ref
            using errcode = '23514';
        end if;
        select * into v_pair_tx
          from public.transactions
         where id = v_pair and userid = v_uid
           for update;
        if not found
           or v_pair_tx.accountid <> v_other.id
           or v_pair_tx.transfer_group_id is not null
           or v_pair_tx.recurringid is not null
           or v_pair_tx.transaction_type = v_type
           or v_pair_tx.amount <> v_cents::numeric / 100
           or abs(v_pair_tx.transaction_date - v_date) > 5
           or (v_pair_tx.transaction_type = 'Income' and v_pair_tx.goalid is not null)
           or v_pair_tx.categoryid is null
           or exists (select 1 from public.same_bill_answers a where a.transactionid = v_pair_tx.id) then
          raise exception 'Row % could not be imported: the entry it was joined to has changed. Nothing was imported.', v_ref
            using errcode = 'SIP01';
        end if;

        insert into public.import_pairings (userid, import_id, transactionid, prior_categoryid, transfer_group_id)
        values (v_uid, v_import, v_pair_tx.id, v_pair_tx.categoryid, v_group);

        -- Its date, amount and account stay: each bank's own record of the
        -- day, and no anchor question re-asked (ruling 2026-11-20).
        perform set_config('sorrel.transfer_edit', 'on', true);
        update public.transactions
           set transfer_group_id = v_group,
               categoryid        = null
         where id = v_pair_tx.id and userid = v_uid;
        perform set_config('sorrel.transfer_edit', '', true);
      end if;
    end if;

    -- "Yes, same bill": link it, step the schedule past the occurrence, and
    -- record the step -- the whole of item 4's answer, inside this call.
    -- For a created transfer, same_bill_answer() answers through the
    -- Expense leg and link_transaction_to_schedule() links both legs.
    if v_same is not null then
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
    if v_diff is not null then
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
  'The one write path for a CSV import: inserts every confirmed row, the batch''s single pre-anchor answer on each, and each "same bill" answer (link + step the schedule + record) -- in one transaction, so all of it or none of it. A row with `transfer` is a transfer: both legs created here (the other leg answering its own account''s pre-anchor question), or an existing plain row on the other account made the other leg, its prior category kept in import_pairings (SIP01 if it no longer qualifies). A category is refused by row number when it isn''t yours, is archived, or is the wrong type. Scoped to auth.uid(); another user''s account is refused (P0002). At most 5,000 rows; every field validated again here; errors name a row number, never its content. A retry with the same p_idempotency_key returns the import already written. SECURITY DEFINER (migrations 68, 76).';


-- ---------------------------------------------------------------------
-- 4. undo_import(): pairings restored first; a later pairing blocks it
-- ---------------------------------------------------------------------
create or replace function public.undo_import(p_import_id uuid)
returns table (out_deleted integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_deleted integer := 0;
  v_r       record;
  v_later   timestamptz;
begin
  if v_uid is null then
    raise exception 'undo_import: no authenticated user';
  end if;
  if not exists (select 1 from public.imports where id = p_import_id and userid = v_uid) then
    raise exception 'undo_import: import not found' using errcode = 'P0002';
  end if;

  -- A later import made one of this import's rows the other leg of its
  -- transfer. Undoing this one would delete that leg and leave the later
  -- import half a transfer: that one goes first. created_at::date is the
  -- person's day inside a request (migration 40).
  select i.created_at into v_later
    from public.import_pairings p
    join public.transactions t on t.id = p.transactionid
    join public.imports i on i.id = p.import_id
   where t.import_id = p_import_id
     and p.import_id <> p_import_id
     and p.userid = v_uid
   order by i.created_at desc
   limit 1;
  if found then
    raise exception 'Undo the import from % first.', to_char(v_later::date, 'YYYY-MM-DD')
      using errcode = 'SIU01';
  end if;

  -- The rows this import joined go back to what they were: not a leg, in
  -- their category. Edits made since (the transfer editor) are kept.
  perform set_config('sorrel.transfer_edit', 'on', true);
  update public.transactions t
     set transfer_group_id = null,
         categoryid        = p.prior_categoryid,
         recurringid       = null
    from public.import_pairings p
   where p.import_id = p_import_id
     and p.userid = v_uid
     and t.id = p.transactionid
     and t.userid = v_uid;
  perform set_config('sorrel.transfer_edit', '', true);
  delete from public.import_pairings where import_id = p_import_id and userid = v_uid;

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
  'Undoes one import atomically. Refuses (SIU01, naming the later import''s date) while a later import joined one of its rows into a transfer. Otherwise puts every row this import joined back as it was (not a leg, its prior category; edits since kept), then deletes every transaction still carrying its import_id (an occurrence a row was matched to comes back through trg_transactions_restore_same_bill, newest answer first), then the import row. out_deleted counts rows, so a created transfer is two. Scoped to auth.uid(); another user''s import is refused (P0002). SECURITY DEFINER (migrations 68, 76).';


-- ---------------------------------------------------------------------
-- 5. list_imports(): occurrences, not rows
-- ---------------------------------------------------------------------
create or replace function public.list_imports()
returns table (
  import_id       uuid,
  accountid       uuid,
  account_name    text,
  created_at      timestamptz,
  row_count       integer,
  remaining_count integer,
  edited_count    integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.id, i.accountid, a.account_name, i.created_at, i.row_count,
         count(distinct coalesce(t.transfer_group_id, t.id))::integer,
         (count(distinct coalesce(t.transfer_group_id, t.id)) filter (where t.updated_at > t.created_at))::integer
    from public.imports i
    join public.accounts a on a.id = i.accountid
    left join public.transactions t on t.import_id = i.id
   group by i.id, a.account_name
   order by i.created_at desc, i.id
$$;

comment on function public.list_imports() is
  'The caller''s imports, newest first: date, account, how many file rows it wrote, how many of those remain, and how many were edited since (updated_at past created_at). Counted as occurrences -- a transfer''s two legs are one (migration 76). security invoker: RLS scopes it (migration 68).';
