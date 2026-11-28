-- =====================================================================
-- Sorrel 82: a goal can be fed by several schedules
--
-- docs/Goals-and-Import.md, Part A and "Rulings after Phase 1"
-- (2026-11-28), rulings 1-3.
--
-- Why: the link lived on the goal (goals.funding_recurringid, 57), one
-- slot per goal, so linking a second schedule overwrote the first --
-- set_goal_funding (57) wrote the goal's one column, and the goal form
-- wrote it too. The link moves to the schedule: a schedule's goal is one
-- field, a goal has a list of schedules, and linking one never touches
-- another.
--
-- 1. recurring_transactions.goalid: the goal this schedule feeds.
--    Composite FK (userid, goalid) -> goals(userid, id) (migration 44's
--    pattern), ON DELETE SET NULL (goalid): deleting a goal unlinks its
--    schedules and they keep running. Recurring TRANSFERS only
--    (recurring_goal_transfer_only), as 57's set_goal_funding required:
--    a confirmed occurrence's Expense leg is what carries the goal.
--    A goal following a card can't be fed by a schedule (70's refusal,
--    reused) and can't start following one while schedules feed it.
--
-- 2. Backfilled from goals.funding_recurringid. Production's duplicate
--    check (a schedule linked from more than one goal) returned no rows,
--    2026-11-28; the backfill refuses to run if any exist, so no project
--    gets an arbitrary pick. The old column STAYS, unread by the new
--    app, until a later migration drops it (and the mirror below) once
--    this deploy has been live a week.
--
-- 3. Push window: the app on production keeps running the previous
--    deploy between `db push` and the deploy. It writes
--    goals.funding_recurringid from the goal form and reads
--    v_goal_monthly_holds. So, temporarily:
--      - trg_goals_mirror_funding copies writes of the old column into
--        recurring_transactions.goalid;
--      - v_goal_monthly_holds (read only by the previous deploy) is
--        re-pointed at the schedule's link, same columns, same meaning.
--    The new app reads neither: it reads v_goal_hold_inputs and nets in
--    the projection (4).
--
-- 4. v_goal_hold_inputs: per goal with a monthly target, the target, its
--    goal money this month and what's left -- the hold BEFORE netting.
--    The netting -- minus this month's occurrences of the goal's
--    schedules that safe to spend already subtracts -- is done inside
--    projectSafeToSpend (lib/safeToSpendProjection.ts) from the very
--    obligations list the walk subtracts, so the two can never be
--    different sets (ruling 3). SQL can't see that set: it's built in
--    TypeScript (expandOccurrences, the horizon, the early edge).
--
-- 5. set_goal_funding(p_recurringid, p_goalid) now writes that one
--    schedule's goalid and nothing else. Same signature, so the previous
--    deploy's recurring form keeps working against it.
--
-- 6. Confirmed occurrences carry the schedule's goal (ruling 1). A
--    BEFORE INSERT trigger sets goalid on the Expense leg of a transfer
--    row inserted with a recurringid whose schedule feeds a goal -- the
--    leg update_transfer() and createTransfer() carry it on. Only
--    confirmOccurrence() inserts with a recurringid. Future inserts only:
--    nothing here links an existing row.
--
-- 7. Past confirmations are the person's choice (ruling 1):
--    link_earlier_occurrences(p_recurringid) links that schedule's
--    unlinked confirmed transfers to its goal and returns their ids, so
--    the app can ask "Is this the same money?" (same_goal_money(), 69)
--    for each. Called only from a tap on the goal page.
--
-- Views: v_goal_hold_inputs is new; v_goal_monthly_holds is replaced in
-- place (same columns). Both carry migration 57's grant block. Functions:
-- pinned search_path, EXECUTE stated explicitly (migration 73's rule).
-- Run docs/view-acl-check.sql after the push.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The link, on the schedule
-- ---------------------------------------------------------------------
alter table public.recurring_transactions
  add column goalid uuid,
  add constraint recurring_transactions_goalid_fkey
      foreign key (userid, goalid)
      references public.goals(userid, id)
      on delete set null (goalid),
  add constraint recurring_goal_transfer_only
      check (goalid is null or to_accountid is not null);

create index idx_recurring_goalid on public.recurring_transactions (goalid) where goalid is not null;

comment on column public.recurring_transactions.goalid is
  'The goal this recurring transfer feeds, or null (migration 82). One schedule, one goal; a goal can have several. Confirmed occurrences carry it on their Expense leg (trg_transactions_occurrence_goal). Transfers only; never a goal that follows a card. Deleting the goal unlinks the schedule, which keeps running.';

-- ---------------------------------------------------------------------
-- 2. Backfill from goals.funding_recurringid
-- ---------------------------------------------------------------------
do $$
declare
  v_dupes int;
begin
  select count(*) into v_dupes
    from (select funding_recurringid
            from public.goals
           where funding_recurringid is not null
           group by funding_recurringid
          having count(*) > 1) d;
  if v_dupes > 0 then
    raise exception 'Migration 82: % schedule(s) are linked from more than one goal. Decide each by hand first.', v_dupes;
  end if;
end
$$;

-- A goal following a card held nothing for its funding link (70), and
-- can't be fed by a schedule now; a link to a non-transfer can't exist
-- (57 required a transfer). Neither is carried over.
update public.recurring_transactions r
   set goalid = g.id
  from public.goals g
 where g.funding_recurringid = r.id
   and g.tracking_method <> 'LinkedAccount'
   and r.to_accountid is not null;

comment on column public.goals.funding_recurringid is
  'DEPRECATED (migration 82): the link moved to recurring_transactions.goalid. Kept, and mirrored into the new column by trg_goals_mirror_funding, only so the previous deploy works between db push and deploy. Unread by the app. Dropped by a later migration.';

-- ---------------------------------------------------------------------
-- 3. A goal following a card is fed by no schedule
-- ---------------------------------------------------------------------
-- 70's refusal reads only new.goalid, so it serves this table as it
-- serves transactions and goal_contributions.
create trigger trg_recurring_refuse_followed_goal
  before insert or update of goalid on public.recurring_transactions
  for each row execute function public.refuse_money_to_followed_goal();

create function public.refuse_card_with_schedules()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_n int;
begin
  if new.tracking_method = 'LinkedAccount' and old.tracking_method is distinct from 'LinkedAccount' then
    select count(*) into v_n from public.recurring_transactions where goalid = new.id;
    if v_n > 0 then
      raise exception '% recurring transfer(s) feed this goal. Unlink them first; payments to the card count through its balance.', v_n
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.refuse_card_with_schedules() is
  'BEFORE UPDATE OF tracking_method on goals: a goal can''t start following a card while recurring transfers feed it (recurring_transactions.goalid) -- the card''s balance is its measure, so they''d count twice. Nothing is unlinked silently; the person unlinks first (migration 82).';

revoke all on function public.refuse_card_with_schedules() from public, anon, authenticated;

create trigger trg_goals_card_schedules
  before update of tracking_method on public.goals
  for each row execute function public.refuse_card_with_schedules();

-- ---------------------------------------------------------------------
-- 4. Push window: the old column's writes reach the new one
--
-- The previous deploy's goal form set the goal's one slot, replacing
-- whatever was there: that's what this reproduces, for that deploy only.
-- The new app never writes funding_recurringid.
-- ---------------------------------------------------------------------
create function public.mirror_goal_funding()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.funding_recurringid is not distinct from old.funding_recurringid then
      return null;
    end if;
    if old.funding_recurringid is not null then
      update public.recurring_transactions
         set goalid = null
       where id = old.funding_recurringid
         and goalid = new.id;
    end if;
  end if;
  if new.funding_recurringid is not null then
    update public.recurring_transactions
       set goalid = new.id
     where id = new.funding_recurringid
       and to_accountid is not null;
  end if;
  return null;
end;
$$;

comment on function public.mirror_goal_funding() is
  'TEMPORARY (migration 82): AFTER INSERT OR UPDATE OF funding_recurringid on goals, copies the previous deploy''s write of the deprecated column into recurring_transactions.goalid. Dropped with the column.';

revoke all on function public.mirror_goal_funding() from public, anon, authenticated;

create trigger trg_goals_mirror_funding
  after insert or update of funding_recurringid on public.goals
  for each row execute function public.mirror_goal_funding();

-- ---------------------------------------------------------------------
-- 5. set_goal_funding: that one schedule, nothing else
-- ---------------------------------------------------------------------
create or replace function public.set_goal_funding(p_recurringid uuid, p_goalid uuid default null)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
begin
  -- The goal is the caller's (RLS hides anyone else's; the composite FK
  -- would refuse it anyway -- this says so in the function's own terms).
  if p_goalid is not null and not exists (select 1 from public.goals where id = p_goalid) then
    raise exception 'Goal not found: %', p_goalid using errcode = 'P0002';
  end if;

  update public.recurring_transactions
     set goalid = p_goalid
   where id = p_recurringid
     and to_accountid is not null;
  if not found then
    raise exception 'Not a recurring transfer: %', p_recurringid using errcode = 'P0002';
  end if;
end
$$;

comment on function public.set_goal_funding(uuid, uuid) is
  'Points one recurring transfer at a goal (or none, p_goalid null) by writing its recurring_transactions.goalid. Touches no other schedule and no goal: a goal can be fed by several (migration 82). SECURITY INVOKER -- RLS and the composite FK do the scoping.';

revoke all on function public.set_goal_funding(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.set_goal_funding(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. A confirmed occurrence carries its schedule's goal
-- ---------------------------------------------------------------------
create function public.occurrence_goal()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  if new.recurringid is not null
     and new.goalid is null
     and new.transaction_type = 'Expense'
     and new.transfer_group_id is not null then
    select r.goalid into new.goalid
      from public.recurring_transactions r
     where r.id = new.recurringid;
  end if;
  return new;
end;
$$;

comment on function public.occurrence_goal() is
  'BEFORE INSERT on transactions (migration 82): a transfer leg inserted with a recurringid -- a confirmed occurrence (confirmOccurrence) -- takes the schedule''s goal on its Expense leg, the leg update_transfer() writes a goal on. Only when the row names no goal itself. Inserts only: no existing row is ever linked here.';

revoke all on function public.occurrence_goal() from public, anon, authenticated;

-- Named to sort before trg_transactions_refuse_followed_goal, so the
-- refusal sees the goal this sets.
create trigger trg_transactions_occurrence_goal
  before insert on public.transactions
  for each row execute function public.occurrence_goal();

-- ---------------------------------------------------------------------
-- 7. Earlier confirmations, counted on a tap
-- ---------------------------------------------------------------------
create function public.link_earlier_occurrences(p_recurringid uuid)
returns table (transaction_id uuid)
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_goalid uuid;
begin
  select r.goalid into v_goalid
    from public.recurring_transactions r
   where r.id = p_recurringid;
  if v_goalid is null then
    raise exception 'This schedule doesn''t feed a goal.' using errcode = 'P0002';
  end if;

  -- Only goalid changes, so the pair can't desync; 59's gate is the way
  -- to write a leg outside update_transfer().
  perform set_config('sorrel.transfer_edit', 'on', true);
  return query
    update public.transactions t
       set goalid = v_goalid
     where t.recurringid = p_recurringid
       and t.transaction_type = 'Expense'
       and t.transfer_group_id is not null
       and t.goalid is null
    returning t.id;
  perform set_config('sorrel.transfer_edit', '', true);
end;
$$;

comment on function public.link_earlier_occurrences(uuid) is
  'Counts a schedule''s earlier confirmed transfers toward the goal it feeds (migration 82, ruling 1): sets goalid on their Expense legs where none is set, and returns their ids so the app asks "Is this the same money?" (same_goal_money) for each. Called only from a tap. SECURITY INVOKER -- RLS scopes it.';

revoke all on function public.link_earlier_occurrences(uuid) from public, anon, authenticated, service_role;
grant execute on function public.link_earlier_occurrences(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. v_goal_hold_inputs: the hold before netting
--
-- 70's v_goal_monthly_holds without its funding exclusion: a funded goal
-- now holds what its schedules don't cover this month, and the netting
-- happens where the occurrences are (4, header).
-- ---------------------------------------------------------------------
create view public.v_goal_hold_inputs with (security_invoker = true) as
select g.userid,
       g.id as goalid,
       g.goal_name,
       g.monthly_contribution,
       coalesce(m.contributed, 0::numeric) as contributed_this_month,
       p.remaining_amount as remaining_to_target
  from public.goals g
  join public.v_goal_progress p on p.goal_id = g.id
  left join lateral (
    select sum(gm.amount) as contributed
      from public.v_goal_money gm
     where gm.goalid = g.id
       and gm.date >= date_trunc('month', current_date::timestamptz)::date
       and gm.date < (date_trunc('month', current_date::timestamptz) + '1 mon'::interval)::date
  ) m on true
 where g.is_active
   and g.completed_at is null
   and g.tracking_method <> 'LinkedAccount'
   and g.monthly_contribution > 0::numeric;

comment on view public.v_goal_hold_inputs is
  'Per active, uncompleted, manual goal with a monthly target: the target, goal money dated this month (v_goal_money) and what''s left to the target. Safe to spend holds min(max(target - goal money this month - this month''s occurrences of the goal''s schedules it already subtracts, 0), left), netted inside projectSafeToSpend from the projection''s own obligations (migration 82). Derived, never stored.';

revoke all on table public.v_goal_hold_inputs from public, anon, authenticated, service_role;
grant select, references, trigger, truncate, maintain on table public.v_goal_hold_inputs to authenticated;
grant references, trigger, truncate, maintain on table public.v_goal_hold_inputs to service_role;

-- ---------------------------------------------------------------------
-- 9. v_goal_monthly_holds, for the previous deploy only
--
-- 70's definition with the funding test re-pointed from the goal's slot
-- to the schedules' links: any counted schedule feeding the goal
-- switches the hold off, which for one schedule is exactly 70. Dropped
-- with funding_recurringid.
-- ---------------------------------------------------------------------
create or replace view public.v_goal_monthly_holds with (security_invoker = true) as
select g.userid,
       g.id as goalid,
       g.goal_name,
       g.monthly_contribution,
       coalesce(m.contributed, 0::numeric) as contributed_this_month,
       least(
         greatest(g.monthly_contribution - coalesce(m.contributed, 0::numeric), 0::numeric),
         p.remaining_amount
       ) as still_to_set_aside,
       p.remaining_amount as remaining_to_target
  from public.goals g
  join public.v_goal_progress p on p.goal_id = g.id
  left join lateral (
    select sum(gm.amount) as contributed
      from public.v_goal_money gm
     where gm.goalid = g.id
       and gm.date >= date_trunc('month', current_date::timestamptz)::date
       and gm.date < (date_trunc('month', current_date::timestamptz) + '1 mon'::interval)::date
  ) m on true
 where g.is_active
   and g.completed_at is null
   and g.tracking_method <> 'LinkedAccount'
   and g.monthly_contribution > 0::numeric
   and not exists (
     select 1
       from public.v_upcoming_recurring u
       join public.recurring_transactions r on r.id = u.recurring_id
      where r.goalid = g.id
        and public.leaves_spendable_set(u.account_type, u.to_account_type)
   );

comment on view public.v_goal_monthly_holds is
  'DEPRECATED (migration 82): read only by the deploy before 82, until it''s replaced; the app reads v_goal_hold_inputs and nets in the projection. 70''s hold with the funding test read from recurring_transactions.goalid. Dropped with goals.funding_recurringid.';

revoke all on table public.v_goal_monthly_holds from public, anon, authenticated, service_role;
grant select, references, trigger, truncate, maintain on table public.v_goal_monthly_holds to authenticated;
grant references, trigger, truncate, maintain on table public.v_goal_monthly_holds to service_role;
