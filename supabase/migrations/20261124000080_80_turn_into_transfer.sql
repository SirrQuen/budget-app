-- =====================================================================
-- Sorrel 80: "Turn into a transfer" on an existing entry
-- (docs/phase-7-findings.md, '"Turn into a transfer" on an existing
-- row'; rulings of 2026-11-24)
--
-- An entry that was really money moving between the person's own
-- accounts -- typed by hand as spending, or imported as spending before
-- migration 76 -- can be made a transfer from the transaction editor:
--
--   join     the other side is already on the other account: a plain,
--            same-cents, opposite-direction entry within 5 days. Both
--            become the transfer's legs; each keeps its date, amount,
--            account and anchor answer (so no balance moves and nothing
--            re-asks); both lose their category, which is kept here.
--   create   the other side is added on the other account, on the
--            entry's date, for its amount, the opposite way, answering
--            THAT account's pre-anchor question.
--
-- The shared rule. Which rows can become a transfer leg, and which entry
-- can be joined as the other side, is ONE check, transfer_leg_refusal(),
-- used by make_transfer() here and by import_transactions() (76's inline
-- check, moved here unchanged in meaning: same SIP01).
--
--   transfer_conversions    one row per conversion: the entry it was made
--                           from and its category, the joined entry and
--                           its category, or the created leg. Cascades
--                           from each transaction -- delete the transfer
--                           and there is nothing left to separate.
--   transfer_leg_refusal()  the shared check (internal; no API role).
--   make_transfer()         the write, atomic. A created side can answer
--                           "Is this the same bill?" for a transfer
--                           schedule's waiting occurrence, as import's
--                           rows do, so a scheduled card payment isn't
--                           counted twice.
--   undo_make_transfer()    Undo / "Separate them instead": the entry and
--                           a joined entry go back to their categories and
--                           stop being a transfer; a created leg is
--                           deleted; a same-bill answer steps its schedule
--                           back. Edits made since (the transfer editor)
--                           are KEPT (ruling 2).
--   separate_import_transfer()
--                           "Separate them instead" for a transfer an
--                           import JOINED to an existing entry (ruling
--                           3, revised): the entry goes back as it was;
--                           the imported side is KEPT and stands alone in
--                           a category the person chooses.
--   import_transactions()   the shared check; otherwise as 76.
--   undo_import()           reverses conversions made FROM its rows first
--                           (ruling 4); refuses (SIU02, naming the date)
--                           while a conversion made from ANOTHER entry
--                           joined one of its rows.
--   undo_import_conversions()
--                           how many conversions an undo will reverse,
--                           for its dialog.
--   delete_own_account()    transfer_conversions goes first.
--
-- SQLSTATEs the app reads (lib/db/transferConversions.ts):
--   SMT01  this entry can't become a transfer (message says why)
--   SMT02  the entry chosen to join has changed (or can't be joined)
--   SMT03  a direction changed since, so the categories can't go back
--   SMT04  separating an import join: the imported side's category is
--          missing or doesn't fit (message says which)
--   SMT05  the bill matched as "the same" has changed since
--   SIU02  undo_import: separate a transfer first (message names the date)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. transfer_conversions
-- ---------------------------------------------------------------------
create table public.transfer_conversions (
  id                      uuid primary key default gen_random_uuid(),
  userid                  uuid not null references public.profiles(id) on delete cascade,
  transfer_group_id       uuid not null,
  -- The entry the person turned into a transfer, and its category before.
  source_transactionid    uuid not null,
  source_prior_categoryid uuid not null,
  -- Exactly one of: the entry joined as the other side (and its category
  -- before), or the leg created on the other account.
  joined_transactionid    uuid,
  joined_prior_categoryid uuid,
  created_transactionid   uuid,
  created_at              timestamptz not null default now(),
  constraint transfer_conversions_group_key unique (transfer_group_id),
  constraint transfer_conversions_source_key unique (source_transactionid),
  constraint transfer_conversions_one_other
    check ((joined_transactionid is null) <> (created_transactionid is null)),
  constraint transfer_conversions_joined_category
    check ((joined_transactionid is null) = (joined_prior_categoryid is null)),
  constraint transfer_conversions_source_fkey
    foreign key (userid, source_transactionid) references public.transactions(userid, id) on delete cascade,
  constraint transfer_conversions_joined_fkey
    foreign key (userid, joined_transactionid) references public.transactions(userid, id) on delete cascade,
  constraint transfer_conversions_created_fkey
    foreign key (userid, created_transactionid) references public.transactions(userid, id) on delete cascade,
  constraint transfer_conversions_source_category_fkey
    foreign key (userid, source_prior_categoryid) references public.categories(userid, id) on delete restrict,
  constraint transfer_conversions_joined_category_fkey
    foreign key (userid, joined_prior_categoryid) references public.categories(userid, id) on delete restrict
);

create index idx_transfer_conversions_userid  on public.transfer_conversions using btree (userid);
create index idx_transfer_conversions_joined  on public.transfer_conversions using btree (joined_transactionid);
create index idx_transfer_conversions_created on public.transfer_conversions using btree (created_transactionid);

comment on table public.transfer_conversions is
  $$One row per entry the person turned into a transfer ("Turn into a transfer", migration 80): the entry and its prior category, and either the entry joined as the other side (with its prior category) or the leg created for it. Written only by make_transfer(), read and deleted by undo_make_transfer() and undo_import(); cascades when any of its transactions is deleted.$$;

alter table public.transfer_conversions enable row level security;

create policy transfer_conversions_select_own on public.transfer_conversions
  for select to authenticated using (userid = (select auth.uid()));

-- 76's grant block: revoke from all four roles, then grant exactly what's
-- used. authenticated reads its own (the editor's Undo, the delete
-- dialog); the functions below write.
revoke all on table public.transfer_conversions from public, anon, authenticated, service_role;
grant select on table public.transfer_conversions to authenticated;
grant references, trigger, truncate, maintain on table public.transfer_conversions to service_role;


-- ---------------------------------------------------------------------
-- 2. transfer_leg_refusal(): THE check, shared by import and conversion
--
-- Why a row can't become a transfer leg, or null when it can. With only
-- p_tx: can this entry become a leg as it is (the entry being turned
-- into a transfer)? With the rest: can it be JOINED as the other side of
-- a transfer on p_accountid whose own leg is p_type, p_amount, p_date?
--
--   account    not on the other account
--   direction  the same way as the other leg
--   amount     not the exact amount
--   date       more than 5 days apart (TRANSFER_MATCH_DAYS)
--   leg        already a transfer leg
--   schedule   confirmed from (or linked to) a schedule
--   category   no category (a plain row always has one)
--   goal       Income with a goal: a transfer carries a goal on its
--              Expense leg only (migration 69)
--   same_bill  carries a "same bill" answer of either kind
--
-- Internal: no API role calls it; the definer functions below do.
-- ---------------------------------------------------------------------
create function public.transfer_leg_refusal(
  p_tx        public.transactions,
  p_accountid uuid    default null,
  p_type      text    default null,
  p_amount    numeric default null,
  p_date      date    default null
)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_accountid is not null and p_tx.accountid <> p_accountid then return 'account'; end if;
  if p_type is not null and p_tx.transaction_type = p_type then return 'direction'; end if;
  if p_amount is not null and p_tx.amount <> p_amount then return 'amount'; end if;
  if p_date is not null and abs(p_tx.transaction_date - p_date) > 5 then return 'date'; end if;
  if p_tx.transfer_group_id is not null then return 'leg'; end if;
  if p_tx.recurringid is not null then return 'schedule'; end if;
  if p_tx.categoryid is null then return 'category'; end if;
  if p_tx.transaction_type = 'Income' and p_tx.goalid is not null then return 'goal'; end if;
  if exists (select 1 from public.same_bill_answers a where a.transactionid = p_tx.id) then return 'same_bill'; end if;
  return null;
end;
$$;

comment on function public.transfer_leg_refusal(public.transactions, uuid, text, numeric, date) is
  $$Why a row can't become a transfer leg (leg, schedule, category, goal, same_bill), or -- given the other leg's account, type, amount and date -- can't be joined as its other side (account, direction, amount, date beyond 5 days, plus those); null when it can. The ONE rule, read by import_transactions() and make_transfer() (migrations 76, 80). Internal.$$;

revoke all on function public.transfer_leg_refusal(public.transactions, uuid, text, numeric, date)
  from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------
-- 3. make_transfer(): one entry becomes a transfer, atomically
--
-- p_transactionid          the entry (plain, the caller's own)
-- p_other_accountid        the other account (own, active, not its own)
-- p_pair_with              an entry there to join, or null to create the
--                          other side
-- p_counts_despite_anchor  the OTHER account's pre-anchor answer for a
-- p_anchor_set_at          created leg, against the opening_set_at the
--                          person was shown (SRA02 if it has moved). Null
--                          when not asked; the anchor trigger refuses a
--                          created leg that needed one (SRA01).
-- p_same_bill              "Yes, they're the same" for a transfer
--                          schedule's occurrence waiting in the queue
--                          whose two ends are these accounts, this way
--                          round: {recurringid, from_run_date,
--                          to_run_date, to_due_date}, as import passes it.
--                          Links both legs and steps the schedule, so a
--                          scheduled card payment isn't counted twice
--                          (same_bill_answer(), migration 68).
-- p_different_bill         "No, keep both": {recurringid, due_date}.
--
-- Either answer only when the other side is CREATED: a joined entry
-- can't also take an occurrence (v1, as import).
--
-- The entry itself keeps its date, amount and account, so its own anchor
-- answer stands. Returns the transfer's group id.
-- ---------------------------------------------------------------------
create function public.make_transfer(
  p_transactionid         uuid,
  p_other_accountid       uuid,
  p_pair_with             uuid        default null,
  p_counts_despite_anchor boolean     default null,
  p_anchor_set_at         timestamptz default null,
  p_same_bill             jsonb       default null,
  p_different_bill        jsonb       default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_src    public.transactions%rowtype;
  v_pair   public.transactions%rowtype;
  v_other  public.accounts%rowtype;
  v_group  uuid := gen_random_uuid();
  v_new    uuid;
  v_why    text;
  v_goal   text;
  v_res    text;
begin
  if v_uid is null then
    raise exception 'make_transfer: no authenticated user';
  end if;
  if p_pair_with is not null and (p_same_bill is not null or p_different_bill is not null) then
    raise exception $msg$A transfer joined to an existing entry can't also be matched to a schedule.$msg$ using errcode = 'SMT02';
  end if;

  select * into v_src
    from public.transactions
   where id = p_transactionid and userid = v_uid
     for update;
  if not found then
    raise exception 'make_transfer: transaction not found' using errcode = 'P0002';
  end if;

  v_why := public.transfer_leg_refusal(v_src);
  if v_why = 'goal' then
    select g.goal_name into v_goal from public.goals g where g.id = v_src.goalid;
    raise exception 'Unlink it from % first.', coalesce(v_goal, 'its goal') using errcode = 'SMT01';
  elsif v_why = 'leg' then
    raise exception 'This is already a transfer.' using errcode = 'SMT01';
  elsif v_why = 'schedule' then
    raise exception 'This came from a schedule, so it stays as it is.' using errcode = 'SMT01';
  elsif v_why = 'same_bill' then
    raise exception 'This entry has a "same bill" answer. Change that answer first.' using errcode = 'SMT01';
  elsif v_why is not null then
    raise exception $msg$This entry can't become a transfer.$msg$ using errcode = 'SMT01';
  end if;

  -- The other account: the caller's own, active, not the entry's own.
  select * into v_other
    from public.accounts
   where id = p_other_accountid and userid = v_uid;
  if not found then
    raise exception 'make_transfer: account not found' using errcode = 'P0002';
  end if;
  if v_other.id = v_src.accountid then
    raise exception 'A transfer needs two different accounts.' using errcode = 'SMT01';
  end if;
  if not v_other.is_active then
    raise exception 'That account is archived.' using errcode = 'SMT01';
  end if;

  if p_pair_with is not null then
    -- Join: re-checked against what the database holds now, locked so two
    -- writes can't both claim it.
    select * into v_pair
      from public.transactions
     where id = p_pair_with and userid = v_uid
       for update;
    if not found or v_pair.id = v_src.id then
      raise exception 'The entry you chose to join has changed. Nothing was changed.' using errcode = 'SMT02';
    end if;
    v_why := public.transfer_leg_refusal(v_pair, v_other.id, v_src.transaction_type, v_src.amount, v_src.transaction_date);
    if v_why = 'goal' then
      select g.goal_name into v_goal from public.goals g where g.id = v_pair.goalid;
      raise exception 'Unlink it from % first.', coalesce(v_goal, 'its goal') using errcode = 'SMT02';
    elsif v_why is not null then
      raise exception 'The entry you chose to join has changed. Nothing was changed.' using errcode = 'SMT02';
    end if;

    insert into public.transfer_conversions
      (userid, transfer_group_id, source_transactionid, source_prior_categoryid,
       joined_transactionid, joined_prior_categoryid)
    values (v_uid, v_group, v_src.id, v_src.categoryid, v_pair.id, v_pair.categoryid);

    -- Dates, amounts and accounts stay: each bank keeps its own day, and
    -- no anchor question is re-asked (as an import's join, ruling
    -- 2026-11-20).
    perform set_config('sorrel.transfer_edit', 'on', true);
    update public.transactions
       set transfer_group_id = v_group, categoryid = null
     where id in (v_src.id, v_pair.id) and userid = v_uid;
    perform set_config('sorrel.transfer_edit', '', true);
  else
    -- Create the other side: opposite type, same date and amount, the
    -- other account's own anchor answer.
    insert into public.transactions
      (userid, accountid, categoryid, transaction_date, description, amount,
       transaction_type, notes, is_estimated, transfer_group_id,
       counts_despite_anchor, anchor_answer_set_at)
    values
      (v_uid, v_other.id, null, v_src.transaction_date, v_src.description, v_src.amount,
       case v_src.transaction_type when 'Expense' then 'Income' else 'Expense' end,
       v_src.notes, v_src.is_estimated, v_group,
       p_counts_despite_anchor,
       case when p_counts_despite_anchor is null then null else p_anchor_set_at end)
    returning id into v_new;

    insert into public.transfer_conversions
      (userid, transfer_group_id, source_transactionid, source_prior_categoryid, created_transactionid)
    values (v_uid, v_group, v_src.id, v_src.categoryid, v_new);

    perform set_config('sorrel.transfer_edit', 'on', true);
    update public.transactions
       set transfer_group_id = v_group, categoryid = null
     where id = v_src.id and userid = v_uid;
    perform set_config('sorrel.transfer_edit', '', true);

    -- "Is this the same bill?" for the transfer it now is, answered as
    -- import answers it: through the Expense leg, both legs linked, the
    -- schedule stepped -- or the "No" remembered.
    if p_same_bill is not null then
      v_res := public.same_bill_answer(
        v_src.id,
        (p_same_bill ->> 'recurringid')::uuid,
        (p_same_bill ->> 'from_run_date')::date,
        (p_same_bill ->> 'to_run_date')::date,
        (p_same_bill ->> 'to_due_date')::date,
        false);
      if v_res <> 'answered' then
        raise exception 'The bill you matched has changed since. Nothing was changed.' using errcode = 'SMT05';
      end if;
    end if;
    if p_different_bill is not null then
      perform public.record_different_bill(
        v_src.id,
        (p_different_bill ->> 'recurringid')::uuid,
        (p_different_bill ->> 'due_date')::date);
    end if;
  end if;

  return v_group;
end;
$$;

comment on function public.make_transfer(uuid, uuid, uuid, boolean, timestamptz, jsonb, jsonb) is
  $$"Turn into a transfer" (migration 80): makes the caller's plain entry one leg of a transfer with p_other_accountid -- joining p_pair_with there (the shared rule, transfer_leg_refusal(); SMT02 if it no longer qualifies) or creating the other leg on the entry's date and amount, answering that account's pre-anchor question. A created side can answer the same-bill question for a transfer schedule's waiting occurrence (p_same_bill / p_different_bill, through same_bill_answer() and record_different_bill(); SMT05 if it moved). Clears the categories and records them in transfer_conversions for undo. SMT01 when the entry itself can't (with why; a goal on what would be the Income leg says "Unlink it from <goal> first."). Atomic; scoped to auth.uid(); another user's entry or account is P0002. SECURITY DEFINER.$$;

revoke all on function public.make_transfer(uuid, uuid, uuid, boolean, timestamptz, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.make_transfer(uuid, uuid, uuid, boolean, timestamptz, jsonb, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- 4. undo_make_transfer(): Undo, and "Separate them instead"
--
-- The entry (and a joined entry) go back to their categories and stop
-- being a transfer; a created leg is deleted. Edits made since through
-- the transfer editor -- date, amount, description, accounts, a swap of
-- from and to -- are KEPT (ruling 2, as import's undo keeps them).
-- update_transfer() moves accounts, never a row's type, so the old
-- category always fits; a row whose type changed anyway (only a
-- service-role fix can) refuses (SMT03) rather than guess a category.
-- ---------------------------------------------------------------------
create function public.undo_make_transfer(p_transfer_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_c    public.transfer_conversions%rowtype;
  v_src  public.transactions%rowtype;
  v_join public.transactions%rowtype;
  v_a    public.same_bill_answers%rowtype;
begin
  if v_uid is null then
    raise exception 'undo_make_transfer: no authenticated user';
  end if;

  select * into v_c
    from public.transfer_conversions
   where transfer_group_id = p_transfer_group_id and userid = v_uid
     for update;
  if not found then
    raise exception 'undo_make_transfer: nothing to separate' using errcode = 'P0002';
  end if;

  select * into v_src from public.transactions where id = v_c.source_transactionid and userid = v_uid for update;
  if v_src.transaction_type is distinct from
     (select c.category_type from public.categories c where c.id = v_c.source_prior_categoryid) then
    raise exception $msg$This transfer's direction changed since, so its entries can't go back to their categories. Delete it and enter them again.$msg$
      using errcode = 'SMT03';
  end if;
  if v_c.joined_transactionid is not null then
    select * into v_join from public.transactions where id = v_c.joined_transactionid and userid = v_uid for update;
    if v_join.transaction_type is distinct from
       (select c.category_type from public.categories c where c.id = v_c.joined_prior_categoryid) then
      raise exception $msg$This transfer's direction changed since, so its entries can't go back to their categories. Delete it and enter them again.$msg$
        using errcode = 'SMT03';
    end if;
  end if;

  -- A "same bill" answer the conversion gave: the schedule steps back onto
  -- the occurrence while it still can (same_bill_restores(), the rule a
  -- delete follows), and the answers go -- the entries stop being the
  -- schedule's. Done before the created leg is deleted, so its delete
  -- trigger finds nothing to restore twice.
  for v_a in
    select * from public.same_bill_answers
     where transactionid in (v_c.source_transactionid, coalesce(v_c.created_transactionid, v_c.joined_transactionid))
       and userid = v_uid
  loop
    if v_a.answer = 'same' and public.same_bill_restores(v_a.recurringid, v_a.advanced_to_run_date) then
      update public.recurring_transactions
         set next_run_date            = v_a.occurrence_run_date,
             next_due_date            = v_a.occurrence_due_date,
             next_amount              = v_a.prior_next_amount,
             next_amount_confirmed_at = v_a.prior_next_amount_confirmed_at
       where id = v_a.recurringid
         and next_run_date = v_a.advanced_to_run_date
         and userid = v_uid;
    end if;
    delete from public.same_bill_answers where id = v_a.id;
  end loop;

  -- The record first: deleting the created leg would cascade it anyway.
  delete from public.transfer_conversions where id = v_c.id;

  if v_c.created_transactionid is not null then
    delete from public.transactions where id = v_c.created_transactionid and userid = v_uid;
  end if;

  perform set_config('sorrel.transfer_edit', 'on', true);
  update public.transactions
     set transfer_group_id = null, categoryid = v_c.source_prior_categoryid, recurringid = null
   where id = v_c.source_transactionid and userid = v_uid;
  if v_c.joined_transactionid is not null then
    update public.transactions
       set transfer_group_id = null, categoryid = v_c.joined_prior_categoryid, recurringid = null
     where id = v_c.joined_transactionid and userid = v_uid;
  end if;
  perform set_config('sorrel.transfer_edit', '', true);
end;
$$;

comment on function public.undo_make_transfer(uuid) is
  $$Undoes one "Turn into a transfer" (migration 80): the entry, and a joined entry, go back to their prior categories and stop being legs; a created leg is deleted; a same-bill answer it gave steps its schedule back while same_bill_restores() holds; the transfer_conversions row goes. Edits made since are kept; a swapped direction refuses (SMT03). Also "Separate them instead" in the delete dialog. Scoped to auth.uid(); P0002 when there is no conversion. SECURITY DEFINER.$$;

revoke all on function public.undo_make_transfer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.undo_make_transfer(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 5. separate_import_transfer(): "Separate them instead" for a transfer
--    an import joined to an existing entry (ruling 3)
--
-- Both rows stand alone afterwards (ruled 2026-11-24): the imported side
-- is real bank data, so it is KEPT, never deleted. The entry the person
-- already had goes back as it was before the import (its category, not a
-- leg; edits since kept). The imported side had no category -- a leg
-- carries none -- so it takes the one the person chooses now:
-- p_categoryid, required, their own, active, of its type (SMT04 if not).
-- Nothing moves a balance: both rows were already counted.
-- ---------------------------------------------------------------------
create function public.separate_import_transfer(p_transfer_group_id uuid, p_categoryid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_p    public.import_pairings%rowtype;
  v_join public.transactions%rowtype;
  v_imp  public.transactions%rowtype;
  v_cat  public.categories%rowtype;
begin
  if v_uid is null then
    raise exception 'separate_import_transfer: no authenticated user';
  end if;

  select * into v_p
    from public.import_pairings
   where transfer_group_id = p_transfer_group_id and userid = v_uid
     for update;
  if not found then
    raise exception 'separate_import_transfer: nothing to separate' using errcode = 'P0002';
  end if;

  select * into v_join from public.transactions where id = v_p.transactionid and userid = v_uid for update;
  if v_join.transaction_type is distinct from
     (select c.category_type from public.categories c where c.id = v_p.prior_categoryid) then
    raise exception $msg$This transfer's direction changed since, so its entries can't go back to their categories. Delete it and enter them again.$msg$
      using errcode = 'SMT03';
  end if;

  -- The imported side: the group's other leg.
  select * into v_imp
    from public.transactions
   where transfer_group_id = p_transfer_group_id and userid = v_uid and id <> v_p.transactionid
     for update;

  -- Its category: required, the person's own, active, of its type.
  if p_categoryid is null then
    raise exception 'Choose a category for the entry from your file.' using errcode = 'SMT04';
  end if;
  select * into v_cat from public.categories where id = p_categoryid and userid = v_uid;
  if not found then
    raise exception 'Choose a category for the entry from your file.' using errcode = 'SMT04';
  end if;
  if not v_cat.is_active then
    raise exception 'That category is archived. Choose another.' using errcode = 'SMT04';
  end if;
  if v_imp.id is not null and v_cat.category_type <> v_imp.transaction_type then
    raise exception 'That category is for %. Choose one for %.',
      case v_cat.category_type when 'Income' then 'income' else 'spending' end,
      case v_imp.transaction_type when 'Income' then 'income' else 'spending' end
      using errcode = 'SMT04';
  end if;

  delete from public.import_pairings where id = v_p.id;

  perform set_config('sorrel.transfer_edit', 'on', true);
  update public.transactions
     set transfer_group_id = null, categoryid = v_p.prior_categoryid, recurringid = null
   where id = v_p.transactionid and userid = v_uid;
  if v_imp.id is not null then
    update public.transactions
       set transfer_group_id = null, categoryid = p_categoryid
     where id = v_imp.id and userid = v_uid;
  end if;
  perform set_config('sorrel.transfer_edit', '', true);
end;
$$;

comment on function public.separate_import_transfer(uuid, uuid) is
  $$"Separate them instead" for a transfer an import joined to an existing entry (migration 80, ruled 2026-11-24): that entry goes back to its prior category and stops being a leg (edits since kept); the imported side is KEPT -- real bank data -- and stands alone in p_categoryid (required: own, active, its type; SMT04 otherwise); the pairing row goes. No balance moves. A swapped direction refuses (SMT03). Scoped to auth.uid(); P0002 when there is no pairing. SECURITY DEFINER.$$;

revoke all on function public.separate_import_transfer(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.separate_import_transfer(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 6. import_transactions(): the pairing check is the shared one
--
-- 76's body, unchanged but for one thing: its inline pair_with check is
-- now transfer_leg_refusal(), the same rule make_transfer() reads, with
-- the same refusal (SIP01). Signature unchanged, so its grants stand.
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
        -- The shared rule (migration 80): transfer_leg_refusal().
        if not found
           or public.transfer_leg_refusal(v_pair_tx, v_other.id, v_type, v_cents::numeric / 100, v_date) is not null then
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
  $$The one write path for a CSV import: inserts every confirmed row, the batch's single pre-anchor answer on each, and each "same bill" answer (link + step the schedule + record) -- in one transaction, so all of it or none of it. A row with `transfer` is a transfer: both legs created here (the other leg answering its own account's pre-anchor question), or an existing plain row on the other account made the other leg, its prior category kept in import_pairings (SIP01 if it no longer qualifies). A category is refused by row number when it isn't yours, is archived, or is the wrong type. Scoped to auth.uid(); another user's account is refused (P0002). At most 5,000 rows; every field validated again here; errors name a row number, never its content. A retry with the same p_idempotency_key returns the import already written. The pair check is transfer_leg_refusal(), shared with make_transfer(). SECURITY DEFINER (migrations 68, 76, 80).$$;



-- ---------------------------------------------------------------------
-- 7. undo_import(): conversions first (ruling 4)
--
-- As 76, plus:
--   * refuses (SIU02, naming the transfer's date) while a conversion made
--     from an entry OUTSIDE this import joined one of its rows: deleting
--     that row would leave the other entry half a transfer. "Separate the
--     transfer from <date> first."
--   * reverses every conversion made FROM one of its rows before deleting
--     them (undo_make_transfer(): a joined entry goes back to its
--     category, a created leg is deleted), so nothing is left half a
--     transfer. Its dialog says how many (undo_import_conversions()).
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
  v_date    date;
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

  -- The same, for "Turn into a transfer": an entry outside this import
  -- was made a transfer by joining one of its rows.
  select s.transaction_date into v_date
    from public.transfer_conversions c
    join public.transactions j on j.id = c.joined_transactionid
    join public.transactions s on s.id = c.source_transactionid
   where j.import_id = p_import_id
     and s.import_id is distinct from p_import_id
     and c.userid = v_uid
   order by s.transaction_date desc
   limit 1;
  if found then
    raise exception 'Separate the transfer from % first.', to_char(v_date, 'YYYY-MM-DD')
      using errcode = 'SIU02';
  end if;

  -- Conversions made from this import's rows are reversed first.
  for v_r in
    select c.transfer_group_id
      from public.transfer_conversions c
      join public.transactions s on s.id = c.source_transactionid
     where s.import_id = p_import_id and c.userid = v_uid
  loop
    perform public.undo_make_transfer(v_r.transfer_group_id);
  end loop;

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
  $$Undoes one import atomically. Refuses (SIU01, naming the later import's date) while a later import joined one of its rows into a transfer, and (SIU02, naming the transfer's date) while a "Turn into a transfer" from an entry outside it joined one of its rows. Otherwise reverses every conversion made from its rows (undo_make_transfer), puts every row this import joined back as it was (not a leg, its prior category; edits since kept), then deletes every transaction still carrying its import_id (an occurrence a row was matched to comes back through trg_transactions_restore_same_bill, newest answer first), then the import row. out_deleted counts rows, so a created transfer is two. Scoped to auth.uid(); another user's import is refused (P0002). SECURITY DEFINER (migrations 68, 76, 80).$$;


-- ---------------------------------------------------------------------
-- 8. undo_import_conversions(): what the undo dialog says
-- ---------------------------------------------------------------------
create function public.undo_import_conversions(p_import_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
    from public.transfer_conversions c
    join public.transactions s on s.id = c.source_transactionid
   where s.import_id = p_import_id
$$;

comment on function public.undo_import_conversions(uuid) is
  $$How many transfers "Undo this import" will separate: conversions made from the import's rows (migration 80). For the dialog ("This also separates 2 transfers made from these rows"). security invoker: RLS scopes it.$$;

revoke all on function public.undo_import_conversions(uuid) from public, anon, authenticated, service_role;
grant execute on function public.undo_import_conversions(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 9. delete_own_account(): conversions and pairings before the
--    transactions
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

  delete from public.transfer_conversions    where userid = v_uid;
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
  $$Permanently deletes the calling user (auth.uid()): every owned row in public.*, their auth.flow_state rows, then their auth.users row, which cascades to profiles and the rest of auth.*. Irreversible, no backup. Takes no argument by design -- a caller can only delete themselves. Transfer conversions and import pairings go first, then transactions, then imports, before the accounts they name (migrations 68, 76, 80).$$;
