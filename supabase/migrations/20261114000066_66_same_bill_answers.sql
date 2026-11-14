-- =====================================================================
-- Migration 66: "Is this the same bill?" -- a schedule occurrence and a
-- future-dated entry for the same bill, counted once
--
-- Since migration 65 a transaction dated after today is counted in the
-- forecast on its date. Someone who enters next month's rent by hand AND
-- has a Rent schedule sees it twice in Upcoming -- "(fixed)" and "(as
-- entered)" -- and Safe to Spend subtracts it twice. On production on
-- 2026-11-13: 5 such pairs, one user, all on Checking.
--
-- The app can't know the two are one event, so it asks
-- (docs/Views-Search-Import-Layout.md, item 4). The match itself (same
-- account, direction and amount, dated within the schedule's tolerance
-- of its next occurrence) lives once, in lib/sameBill.ts. This migration
-- holds the answers and the writes:
--
--   "Yes, they're the same" -- confirm_same_bill(): links the entry to
--     the schedule (link_transaction_to_schedule, migration 60) AND moves
--     the schedule past that occurrence, in one call. Linking alone sets
--     recurringid and nothing else; the occurrence would still be counted
--     beside the entry and still asked about on the day. The answer row
--     remembers where the schedule was, so the step can be undone.
--
--   "No, keep both" -- record_different_bill(): a row saying so, keyed on
--     (schedule, transaction), so that pair is never asked again.
--     Reversible: clear_different_bill() removes it and the question
--     comes back ("Change your answer" on the transaction).
--
--   Deleting the entry after a "Yes" -- trg_transactions_restore_same_bill
--     puts the occurrence back, so the bill isn't in neither place, IF
--     the schedule hasn't moved since (same_bill_restores(): its cursor is
--     still where the "Yes" left it). Otherwise nothing is restored, and
--     the delete confirmation has already said so, from
--     same_bill_delete_preview(), which reads the same rule. A trigger,
--     not app code: three delete paths reach transactions (one row, a
--     bulk selection, a transfer's two legs), plus anything run as the
--     table owner.
--
-- Writes only through these functions. authenticated gets SELECT on the
-- table and nothing else: a client-written "same" row would carry restore
-- state the delete trigger acts on, so it must only ever be written
-- together with the link and the step it records.
--
-- Nothing here writes during a render: every write is a person's answer
-- or a person's delete.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The answers
-- ---------------------------------------------------------------------
create table public.same_bill_answers (
  id                   uuid primary key default gen_random_uuid(),
  userid               uuid not null references public.profiles(id) on delete cascade,
  recurringid          uuid not null,
  -- A transfer's Expense leg stands for the pair, as in v_future_transactions.
  transactionid        uuid not null,
  answer               text not null check (answer in ('same', 'different')),
  -- The occurrence the question was about (next_due_date when it was
  -- asked) -- "You said this isn't Rent's 1 December payment".
  occurrence_due_date  date not null,
  -- "same" only: the cursor the answer moved, and where it moved it to.
  -- Restoring puts back exactly what the step replaced.
  occurrence_run_date  date,
  advanced_to_run_date date,
  prior_next_amount              numeric(12,2),
  prior_next_amount_confirmed_at timestamptz,
  created_at           timestamptz not null default now(),
  constraint same_bill_answers_recurringid_fkey
    foreign key (userid, recurringid) references public.recurring_transactions(userid, id) on delete cascade,
  constraint same_bill_answers_transactionid_fkey
    foreign key (userid, transactionid) references public.transactions(userid, id) on delete cascade,
  constraint same_bill_answers_one_per_pair unique (recurringid, transactionid),
  constraint same_bill_answers_same_has_step check (
    answer = 'different'
    or (occurrence_run_date is not null and advanced_to_run_date is not null
        and advanced_to_run_date > occurrence_run_date))
);

create index idx_same_bill_answers_transactionid on public.same_bill_answers using btree (transactionid);
create index idx_same_bill_answers_userid on public.same_bill_answers using btree (userid);

comment on table public.same_bill_answers is
  'Answers to "Is this the same bill?" -- a schedule''s next occurrence vs a future-dated entry on the same account, amount and date window (lib/sameBill.ts). "same": the entry was linked and the schedule stepped past the occurrence; the row records the step so deleting the entry can undo it (trg_transactions_restore_same_bill). "different": never ask about this pair again; reversible with clear_different_bill(). Written only by confirm_same_bill(), record_different_bill() and clear_different_bill() (migration 66).';

alter table public.same_bill_answers enable row level security;

create policy same_bill_answers_select_own on public.same_bill_answers
  for select to authenticated using (userid = (select auth.uid()));

-- A new table picks up the project's default privileges, and those differ
-- between our projects (CLAUDE.md, migration 57's grant block). Revoke
-- from all four roles, then grant exactly what's used: authenticated
-- reads its own rows (the functions below write them), and service_role
-- carries what every baseline table gives it -- nothing that reads or
-- writes rows.
revoke all on table public.same_bill_answers from public, anon, authenticated, service_role;
grant select on table public.same_bill_answers to authenticated;
grant references, trigger, truncate, maintain on table public.same_bill_answers to service_role;


-- ---------------------------------------------------------------------
-- 2. THE restore rule: has the schedule moved since the "Yes"?
-- ---------------------------------------------------------------------
create function public.same_bill_restores(p_recurring_id uuid, p_advanced_to_run_date date)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.recurring_transactions r
     where r.id = p_recurring_id
       and r.next_run_date = p_advanced_to_run_date)
$$;

comment on function public.same_bill_restores(uuid, date) is
  'Can a "same bill" step be undone? True while the schedule''s cursor (next_run_date) is still where confirm_same_bill() moved it -- nothing has answered or skipped a cycle since, so putting it back reopens only the occurrence the entry filled. Read by the delete trigger and by same_bill_delete_preview(); never restate it (migration 66).';

revoke all on function public.same_bill_restores(uuid, date) from public, anon;
grant execute on function public.same_bill_restores(uuid, date) to authenticated;


-- ---------------------------------------------------------------------
-- 3. "Yes, they're the same"
-- ---------------------------------------------------------------------
-- p_to_run_date / p_to_due_date: the schedule's next cycle, computed by
-- the app's cadence and business-day code (lib/recurringCadence.ts,
-- lib/businessDays.ts) exactly as "Not happening" computes it -- one
-- implementation of schedule math, not a second one here. They're the
-- caller's own schedule's dates, which the caller can already write.
create function public.confirm_same_bill(
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
declare
  v_uid   uuid := auth.uid();
  v_sched public.recurring_transactions%rowtype;
  v_tx    public.transactions%rowtype;
begin
  if v_uid is null then
    raise exception 'confirm_same_bill: no authenticated user';
  end if;
  if p_to_run_date is null or p_to_due_date is null or p_to_run_date <= p_from_run_date then
    raise exception 'confirm_same_bill: the next cycle must come after this one' using errcode = '22023';
  end if;

  select * into v_sched
    from public.recurring_transactions
   where id = p_recurring_id and userid = v_uid
     for update;
  if not found then
    raise exception 'confirm_same_bill: schedule not found' using errcode = 'P0002';
  end if;

  select * into v_tx
    from public.transactions
   where id = p_transaction_id and userid = v_uid;
  if not found then
    raise exception 'confirm_same_bill: transaction not found' using errcode = 'P0002';
  end if;
  -- A transfer is answered through its Expense leg.
  if v_tx.transfer_group_id is not null and v_tx.transaction_type <> 'Expense' then
    select * into v_tx
      from public.transactions
     where transfer_group_id = v_tx.transfer_group_id and transaction_type = 'Expense' and userid = v_uid;
    if not found then
      raise exception 'confirm_same_bill: transaction not found' using errcode = 'P0002';
    end if;
  end if;

  -- The claim, as every queue answer makes it: only while the cursor is
  -- still the occurrence the question showed.
  if v_sched.next_run_date is distinct from p_from_run_date then
    return 'already_answered';
  end if;
  -- Only an entry dated ahead -- one the forecast counts on its own date.
  if v_tx.transaction_date <= current_date then
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

comment on function public.confirm_same_bill(uuid, uuid, date, date, date) is
  '"Yes, they''re the same": links a future-dated entry to the schedule (link_transaction_to_schedule) and steps the schedule past the occurrence it fills, recording the step in same_bill_answers so deleting the entry can undo it. Claims on p_from_run_date like every queue answer. Returns answered | already_answered | not_ahead | not_linkable. SECURITY DEFINER, scoped to auth.uid() (migration 66).';

revoke all on function public.confirm_same_bill(uuid, uuid, date, date, date) from public, anon;
grant execute on function public.confirm_same_bill(uuid, uuid, date, date, date) to authenticated;


-- ---------------------------------------------------------------------
-- 4. "No, keep both", and changing that answer
-- ---------------------------------------------------------------------
create function public.record_different_bill(
  p_transaction_id      uuid,
  p_recurring_id        uuid,
  p_occurrence_due_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tx  public.transactions%rowtype;
begin
  if v_uid is null then
    raise exception 'record_different_bill: no authenticated user';
  end if;
  if not exists (select 1 from public.recurring_transactions where id = p_recurring_id and userid = v_uid) then
    raise exception 'record_different_bill: schedule not found' using errcode = 'P0002';
  end if;
  select * into v_tx from public.transactions where id = p_transaction_id and userid = v_uid;
  if not found then
    raise exception 'record_different_bill: transaction not found' using errcode = 'P0002';
  end if;
  if v_tx.transfer_group_id is not null and v_tx.transaction_type <> 'Expense' then
    select * into v_tx
      from public.transactions
     where transfer_group_id = v_tx.transfer_group_id and transaction_type = 'Expense' and userid = v_uid;
    if not found then
      raise exception 'record_different_bill: transaction not found' using errcode = 'P0002';
    end if;
  end if;

  -- A pair already answered "same" stays answered: that entry is linked.
  insert into public.same_bill_answers (userid, recurringid, transactionid, answer, occurrence_due_date)
  values (v_uid, p_recurring_id, v_tx.id, 'different', p_occurrence_due_date)
  on conflict (recurringid, transactionid) do nothing;
end;
$$;

comment on function public.record_different_bill(uuid, uuid, date) is
  '"No, keep both": records that this entry is not this schedule''s occurrence, so the pair is never asked again. A pair already answered "same" is left alone. Undone by clear_different_bill(). SECURITY DEFINER, scoped to auth.uid() (migration 66).';

revoke all on function public.record_different_bill(uuid, uuid, date) from public, anon;
grant execute on function public.record_different_bill(uuid, uuid, date) to authenticated;

create function public.clear_different_bill(
  p_transaction_id uuid,
  p_recurring_id   uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'clear_different_bill: no authenticated user';
  end if;
  -- Either leg of a transfer names the pair.
  delete from public.same_bill_answers sba
   where sba.userid = v_uid
     and sba.recurringid = p_recurring_id
     and sba.answer = 'different'
     and sba.transactionid in (
       select t.id from public.transactions t
        where t.userid = v_uid
          and (t.id = p_transaction_id
               or t.transfer_group_id = (select x.transfer_group_id from public.transactions x
                                          where x.id = p_transaction_id and x.userid = v_uid)));
end;
$$;

comment on function public.clear_different_bill(uuid, uuid) is
  '"Change your answer" on a "No, keep both": removes that answer, so the pair is asked again if it still matches. Never touches a "same" answer. SECURITY DEFINER, scoped to auth.uid() (migration 66).';

revoke all on function public.clear_different_bill(uuid, uuid) from public, anon;
grant execute on function public.clear_different_bill(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 5. Deleting the entry after a "Yes": put the occurrence back
-- ---------------------------------------------------------------------
-- BEFORE DELETE: the answer row cascades away with the transaction, so it
-- has to be read first. Security invoker: a person deleting their own row
-- can read their own answer and write their own schedule's cursor (the
-- queue writes it the same way); the table owner and delete_own_account()
-- (which deletes transactions before schedules, in separate statements)
-- pass through unchanged.
create function public.restore_same_bill_occurrence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_answer public.same_bill_answers%rowtype;
begin
  select * into v_answer
    from public.same_bill_answers
   where transactionid = old.id and answer = 'same';
  if found and public.same_bill_restores(v_answer.recurringid, v_answer.advanced_to_run_date) then
    update public.recurring_transactions
       set next_run_date            = v_answer.occurrence_run_date,
           next_due_date            = v_answer.occurrence_due_date,
           next_amount              = v_answer.prior_next_amount,
           next_amount_confirmed_at = v_answer.prior_next_amount_confirmed_at
     where id = v_answer.recurringid
       and next_run_date = v_answer.advanced_to_run_date;
  end if;
  return old;
end;
$$;

comment on function public.restore_same_bill_occurrence() is
  'trg_transactions_restore_same_bill: when an entry answered "same bill" is deleted, steps its schedule back onto the occurrence it filled -- only while same_bill_restores() holds, so no answered cycle is reopened. Otherwise the delete confirmation said the bill leaves the forecast (same_bill_delete_preview). Migration 66.';

revoke all on function public.restore_same_bill_occurrence() from public, anon, authenticated;

create trigger trg_transactions_restore_same_bill
  before delete on public.transactions
  for each row execute function public.restore_same_bill_occurrence();


-- ---------------------------------------------------------------------
-- 6. What a delete will do, for the confirmation
-- ---------------------------------------------------------------------
create function public.same_bill_delete_preview(p_transaction_ids uuid[])
returns table (
  transaction_id      uuid,
  transfer_group_id   uuid,
  schedule_name       text,
  occurrence_due_date date,
  restores            boolean,
  resumes_on          date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id, t.transfer_group_id, r.description, a.occurrence_due_date,
         public.same_bill_restores(a.recurringid, a.advanced_to_run_date),
         r.next_due_date
    from public.same_bill_answers a
    join public.transactions t on t.id = a.transactionid
    join public.recurring_transactions r on r.id = a.recurringid
   where a.answer = 'same'
     and (t.id = any(p_transaction_ids)
          or t.transfer_group_id in (select x.transfer_group_id from public.transactions x
                                      where x.id = any(p_transaction_ids)))
$$;

comment on function public.same_bill_delete_preview(uuid[]) is
  'For each entry among p_transaction_ids (either leg of a transfer) answered "same bill": the schedule, the occurrence it filled, whether deleting it puts that occurrence back (same_bill_restores) and, if not, when the schedule picks up again. Read by the delete confirmations (migration 66).';

revoke all on function public.same_bill_delete_preview(uuid[]) from public, anon;
grant execute on function public.same_bill_delete_preview(uuid[]) to authenticated;
