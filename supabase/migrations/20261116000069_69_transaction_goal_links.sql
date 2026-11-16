-- =====================================================================
-- Sorrel 69: a transaction can be for a goal
--
-- docs/Log-Again-and-Goal-Links.md, section 3. Rulings 2026-11-16.
--
-- Why: today a $200 Checking -> Savings transfer made for a goal lowers
-- safe to spend twice -- once through the balance (the trough falls $200)
-- and once through the goal's hold (v_goal_monthly_holds, 57), which only
-- sees goal_contributions and so still holds the full $200. Confirmed in
-- the goals Phase 1 report (2026-11-16): $2,500 becomes $2,300 when it
-- should stay $2,500. Linking the transfer to the goal makes the hold
-- see the money, and the figure stays put.
--
-- 1. transactions.goalid (in the baseline since before 44; never written
--    by the app until now, 0 rows on production 2026-11-16) is the link.
--    THE TRANSACTION IS THE CONTRIBUTION: its amount is read from the
--    transaction on every read and is never copied into
--    goal_contributions. Edit the amount and the goal follows; delete
--    the transaction and the contribution goes with it.
--
-- 2. Only an Expense row carries a goal: CHECK (goalid is null or
--    transaction_type = 'Expense'). That one rule does two jobs:
--    - Income is never linkable (it lands in spendable money; counting it
--      as saved while it's still spendable counts it twice).
--    - A transfer carries its goal on exactly ONE leg, the Expense leg.
--      Why that leg: it is already the transfer's canonical row -- the
--      source the transfer editor writes from (update_transfer, 59), the
--      leg that carries the idempotency key (createTransfer) and the leg
--      a "same bill" answer is stored on (66). One row per transfer means
--      one contribution per transfer, never one per leg, with no
--      de-duplication anywhere downstream. The Income leg can't carry it.
--    An existing transfer's goal is written only by update_transfer()
--    (redefined below with p_goalid): trg_transactions_transfer_pair (59)
--    already refuses every other UPDATE of a leg. A new transfer's legs
--    are written together by createTransfer's one insert, the transfer's
--    only create path, which sets it on the Expense leg.
--
-- 3. v_goal_money: THE one source of goal money -- manual contributions
--    plus linked transactions, one row each. Read by v_goal_progress,
--    v_goals_summary, v_goal_monthly_holds and goal_completed_at() (the
--    53 completion triggers). Nothing sums the two separately.
--    A linked transaction counts from entry, whatever its date -- the same
--    as a manual contribution, which can also be dated ahead. Two reasons:
--    (a) the hold must see a FUTURE-dated linked transfer this month, or
--    the projection (which subtracts the transfer on its date, 65) and
--    the hold would count it twice -- the very bug this fixes; (b)
--    completion stays write-driven, so no goal completes by a date
--    passing with nothing written. The goal page can still show the date.
--
-- 4. Completion (53) re-derives on transaction writes too: an AFTER
--    trigger on transactions fires when a row with a goal is inserted or
--    deleted, or an update sets, changes or clears goalid, or changes a
--    linked row's amount. It re-derives both the old and the new goal.
--
-- 5. "Is this the same money?" (section 3): same_goal_money() is the one
--    rule -- a hand-entered contribution to the same goal, same amount,
--    dated within 3 days of the transaction. The app asks after a save
--    that links; "Yes" is replace_contribution_with_link(), which deletes
--    the hand entry only if it still matches. "No" writes nothing.
--
-- 6. goal_contributions.funding_method's default was 'Manual', which its
--    own check refuses (it allows 'manual'). The app always passes
--    'manual', so it never bit; fixed here.
--
-- Views: v_goal_money is new; v_goal_progress, v_goals_summary and
-- v_goal_monthly_holds are replaced in place (same columns). All four
-- carry migration 57's grant block, explicitly, so neither project's
-- default privileges decide them (CLAUDE.md). Run docs/view-acl-check.sql
-- after the push.
--
-- Not here, by ruling: goals that follow a card (70, after this merges --
-- they'll be excluded from linking then); auto-linking a goal-funding
-- schedule's confirmed occurrences (queued); import never sets a goal.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The default that its own check refused
-- ---------------------------------------------------------------------
alter table public.goal_contributions alter column funding_method set default 'manual';

-- ---------------------------------------------------------------------
-- 2. Only an Expense row carries a goal
-- ---------------------------------------------------------------------
alter table public.transactions
  add constraint transactions_goal_expense_only
  check (goalid is null or transaction_type = 'Expense');

comment on column public.transactions.goalid is
  'The goal this transaction is for (migration 69). The transaction IS the contribution: its amount is read on every read (v_goal_money), never copied. Expense rows only (transactions_goal_expense_only): income is never linkable, and a transfer carries it on its Expense leg only. An existing transfer''s goal is written only by update_transfer().';

-- ---------------------------------------------------------------------
-- 2b. Deleting a goal unlinks its transfers
--
-- transactions.goalid is ON DELETE SET NULL (goalid) (44): deleting a
-- goal UPDATEs the rows that counted toward it. On a transfer leg, 59's
-- pair trigger refused every UPDATE outside update_transfer(), so deleting
-- a goal a transfer counted toward would have failed. One shape is let
-- through: clearing goalid with nothing else changed (updated_at aside,
-- which set_updated_at may already have moved). That can't desync the
-- pair -- the amounts, dates and accounts are untouched -- and it's
-- exactly what the FK action writes. Setting or changing a goal on a leg
-- still goes through update_transfer().
-- ---------------------------------------------------------------------
create or replace function public.enforce_transfer_pair()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if (old.transfer_group_id is not null or new.transfer_group_id is not null)
     and coalesce(current_setting('sorrel.transfer_edit', true), '') <> 'on'
     and not (
       old.goalid is not null
       and new.goalid is null
       and (to_jsonb(new) - 'goalid' - 'updated_at') = (to_jsonb(old) - 'goalid' - 'updated_at')
     ) then
    raise exception 'A transfer is edited as a pair, through update_transfer()'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.enforce_transfer_pair() is
  'BEFORE UPDATE on transactions: refuses any update to a transfer leg (or one that would make a row a leg) unless update_transfer() opened the gate (sorrel.transfer_edit = on, transaction-local). Editing one leg desyncs the pair -- money that doesn''t net to zero (migration 59). One exception (migration 69): clearing goalid and nothing else, which is what deleting the goal writes (ON DELETE SET NULL).';

-- ---------------------------------------------------------------------
-- 3. v_goal_money: the one source of goal money
-- ---------------------------------------------------------------------
create view public.v_goal_money with (security_invoker = true) as
select gc.userid,
       gc.goalid,
       gc.amount,
       gc.date,
       'contribution'::text as source,
       gc.id   as contribution_id,
       null::uuid as transaction_id
  from public.goal_contributions gc
union all
-- Expense rows only (the check above), so `amount` is money toward the
-- goal as it stands -- no signed_amount() needed, and one row per transfer.
select t.userid,
       t.goalid,
       t.amount,
       t.transaction_date as date,
       'transaction'::text as source,
       null::uuid as contribution_id,
       t.id    as transaction_id
  from public.transactions t
 where t.goalid is not null;

comment on view public.v_goal_money is
  'Every dollar counted toward a goal, one row each: hand-entered contributions plus transactions linked by transactions.goalid (migration 69). THE source for goal progress, the monthly holds and completion -- nothing sums goal_contributions or linked transactions on its own.';

revoke all on table public.v_goal_money from public, anon, authenticated, service_role;
grant select, references, trigger, truncate, maintain on table public.v_goal_money to authenticated;
grant references, trigger, truncate, maintain on table public.v_goal_money to service_role;

-- ---------------------------------------------------------------------
-- 4. Completion reads it (53's rule, re-pointed)
-- ---------------------------------------------------------------------
create or replace function public.goal_completed_at(p_goal_id uuid, p_target numeric, p_current timestamptz)
returns timestamptz
language sql
stable
security invoker
set search_path to ''
as $$
  select case
    when coalesce((select sum(m.amount) from public.v_goal_money m where m.goalid = p_goal_id), 0)
         >= p_target
      then coalesce(p_current, now())
    else null
  end;
$$;

comment on function public.goal_completed_at(uuid, numeric, timestamptz) is
  'completed_at for a goal: kept while its goal money (v_goal_money, migration 69) >= target, now() on first reaching it, null below it.';

-- A transaction write that moves goal money re-derives the goal(s) it
-- touched, writing only when completed_at actually changes (53's pattern).
create or replace function public.transactions_sync_goal_completed_at()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_old uuid := case when tg_op in ('UPDATE', 'DELETE') then old.goalid end;
  v_new uuid := case when tg_op in ('INSERT', 'UPDATE') then new.goalid end;
begin
  if v_old is null and v_new is null then
    return null;   -- not linked before or after: no goal involved
  end if;
  if tg_op = 'UPDATE'
     and v_old is not distinct from v_new
     and old.amount = new.amount then
    return null;   -- a linked row's description or date: no goal money moved
  end if;

  update public.goals g
     set completed_at = public.goal_completed_at(g.id, g.target_amount, g.completed_at)
   where g.id in (v_old, v_new)
     and g.completed_at is distinct from public.goal_completed_at(g.id, g.target_amount, g.completed_at);

  return null;
end;
$$;

comment on function public.transactions_sync_goal_completed_at() is
  'AFTER trigger on transactions (migration 69): when a linked row is inserted or deleted, or an update sets, changes or clears goalid or changes a linked row''s amount, re-derives completed_at for the goal(s) involved.';

revoke all on function public.transactions_sync_goal_completed_at() from public;

create trigger trg_transactions_goal_completed_at
  after insert or delete or update of goalid, amount on public.transactions
  for each row execute function public.transactions_sync_goal_completed_at();

-- ---------------------------------------------------------------------
-- 5. v_goal_progress reads v_goal_money
--
-- 53's definition exactly, with the lateral re-pointed from
-- goal_contributions to v_goal_money. contribution_count and
-- last_contribution_date now count linked transactions too.
-- ---------------------------------------------------------------------
create or replace view public.v_goal_progress with (security_invoker = true) as
 SELECT g.id AS goal_id,
    g.userid,
    g.goal_name,
    g.goal_type,
    g.status,
    g.tracking_method,
    g.accountid,
    g.target_amount,
    g.target_date,
    g.monthly_contribution,
    COALESCE(c.contributed, (0)::numeric) AS contributed_amount,
    GREATEST((g.target_amount - COALESCE(c.contributed, (0)::numeric)), (0)::numeric) AS remaining_amount,
    round((LEAST((COALESCE(c.contributed, (0)::numeric) / NULLIF(g.target_amount, (0)::numeric)), (1)::numeric) * (100)::numeric), 1) AS pct_complete,
    COALESCE(c.contribution_count, (0)::bigint) AS contribution_count,
    c.last_contribution_date,
        CASE
            WHEN (COALESCE(c.contributed, (0)::numeric) >= g.target_amount) THEN CURRENT_DATE
            WHEN (g.monthly_contribution > (0)::numeric) THEN ((CURRENT_DATE + ((ceil(((g.target_amount - COALESCE(c.contributed, (0)::numeric)) / g.monthly_contribution)))::double precision * '1 mon'::interval)))::date
            ELSE NULL::date
        END AS projected_completion_date,
        CASE
            WHEN (g.target_date IS NULL) THEN NULL::boolean
            WHEN (COALESCE(c.contributed, (0)::numeric) >= g.target_amount) THEN true
            WHEN (g.monthly_contribution > (0)::numeric) THEN (((CURRENT_DATE + ((ceil(((g.target_amount - COALESCE(c.contributed, (0)::numeric)) / g.monthly_contribution)))::double precision * '1 mon'::interval)))::date <= g.target_date)
            ELSE false
        END AS is_on_track,
    g.completed_at,
    g.is_active
   FROM (public.goals g
     LEFT JOIN LATERAL ( SELECT sum(m.amount) AS contributed,
            count(*) AS contribution_count,
            max(m.date) AS last_contribution_date
           FROM public.v_goal_money m
          WHERE (m.goalid = g.id)) c ON (true));

revoke all on table public.v_goal_progress from public, anon, authenticated, service_role;
grant select, references, trigger, truncate, maintain on table public.v_goal_progress to authenticated;
grant references, trigger, truncate, maintain on table public.v_goal_progress to service_role;

-- ---------------------------------------------------------------------
-- 6. v_goals_summary's this-month figure reads v_goal_money
--
-- 53's definition exactly, with the lateral re-pointed.
-- ---------------------------------------------------------------------
create or replace view public.v_goals_summary with (security_invoker = true) as
select g.userid,
       count(*) as total_goals,
       count(*) filter (where g.status = 'Active') as active_goals,
       count(*) filter (where g.status = 'Completed') as completed_goals,
       count(*) filter (where g.status = 'Active' and g.is_on_track) as goals_on_track,
       count(*) filter (where g.status = 'Active' and g.is_on_track is false) as goals_off_track,
       coalesce(sum(g.target_amount) filter (where g.status = 'Active'), 0::numeric) as total_target,
       coalesce(sum(g.contributed_amount) filter (where g.status = 'Active'), 0::numeric) as total_saved,
       coalesce(sum(g.remaining_amount) filter (where g.status = 'Active'), 0::numeric) as total_remaining,
       coalesce(sum(g.monthly_contribution) filter (where g.status = 'Active'), 0::numeric) as planned_monthly_contribution,
       coalesce(m.contributed_this_month, 0::numeric) as contributed_this_month,
       case
         when sum(g.target_amount) filter (where g.status = 'Active') > 0::numeric
           then round(sum(g.contributed_amount) filter (where g.status = 'Active')
                      / sum(g.target_amount) filter (where g.status = 'Active') * 100::numeric, 1)
         else null::numeric
       end as overall_pct_complete
  from public.v_goal_progress g
  left join lateral (
    select sum(gm.amount) as contributed_this_month
      from public.v_goal_money gm
      join public.goals g2 on g2.id = gm.goalid
     where g2.userid = g.userid
       and g2.is_active
       and gm.date >= date_trunc('month', current_date::timestamptz)::date
       and gm.date < (date_trunc('month', current_date::timestamptz) + '1 mon'::interval)::date
  ) m on true
 where g.is_active
 group by g.userid, m.contributed_this_month;

revoke all on table public.v_goals_summary from public, anon, authenticated, service_role;
grant select, references, trigger, truncate, maintain on table public.v_goals_summary to authenticated;
grant references, trigger, truncate, maintain on table public.v_goals_summary to service_role;

-- ---------------------------------------------------------------------
-- 7. v_goal_monthly_holds reads v_goal_money
--
-- 57's definition exactly, with "contributed this month" re-pointed. A
-- linked transaction dated this month -- today, earlier, or later this
-- month -- now lowers the hold by its amount.
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
   and g.monthly_contribution > 0::numeric
   and not exists (
     select 1
       from public.v_upcoming_recurring u
      where u.recurring_id = g.funding_recurringid
        and public.leaves_spendable_set(u.account_type, u.to_account_type)
   );

comment on view public.v_goal_monthly_holds is
  'Per goal, this month''s money safe to spend sets aside: max(0, monthly_contribution - goal money dated this month), capped at what''s left to the target (v_goal_progress.remaining_amount), for active, uncompleted goals with a monthly target and no counted funding transfer (goals.funding_recurringid). Goal money is v_goal_money -- hand entries and linked transactions (migration 69). Derived, never stored. Read by getSafeToSpend (lib/db/dashboard.ts); subtracted flat, after the cushion, never raising the running-low line.';

revoke all on table public.v_goal_monthly_holds from public, anon, authenticated, service_role;
grant select, references, trigger, truncate, maintain on table public.v_goal_monthly_holds to authenticated;
grant references, trigger, truncate, maintain on table public.v_goal_monthly_holds to service_role;

-- ---------------------------------------------------------------------
-- 8. "Is this the same money?"
-- ---------------------------------------------------------------------
create function public.same_goal_money(p_transaction_id uuid)
returns table (contribution_id uuid, goalid uuid, amount numeric, contribution_date date)
language sql
stable
security invoker
set search_path to ''
as $$
  select gc.id, gc.goalid, gc.amount, gc.date
    from public.transactions t
    join public.goal_contributions gc
      on gc.goalid = t.goalid
     and gc.amount = t.amount
     and gc.date between t.transaction_date - 3 and t.transaction_date + 3
   where t.id = p_transaction_id
     and gc.funding_method = 'manual'
   order by abs(gc.date - t.transaction_date), gc.created_at desc;
$$;

comment on function public.same_goal_money(uuid) is
  'THE "Is this the same money?" rule (migration 69): hand-entered contributions to the transaction''s goal with the same amount, dated within 3 days of it, nearest first. Asked after a save that links; never merged silently. SECURITY INVOKER -- RLS scopes both tables.';

revoke all on function public.same_goal_money(uuid) from public, anon;
grant execute on function public.same_goal_money(uuid) to authenticated;

-- "Yes": the link replaces the hand entry. Deletes the contribution only
-- while it still matches the transaction by the rule above.
create function public.replace_contribution_with_link(p_transaction_id uuid, p_contribution_id uuid)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
begin
  delete from public.goal_contributions gc
   where gc.id = p_contribution_id
     and gc.id in (select s.contribution_id from public.same_goal_money(p_transaction_id) s);
  if not found then
    raise exception 'That contribution no longer matches this transaction.' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.replace_contribution_with_link(uuid, uuid) is
  '"Yes, it''s the same money" (migration 69): deletes the hand-entered contribution, which the linked transaction now counts instead -- only while same_goal_money() still pairs them. P0002 otherwise.';

revoke all on function public.replace_contribution_with_link(uuid, uuid) from public, anon;
grant execute on function public.replace_contribution_with_link(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 9. update_transfer(): the goal, on the Expense leg
--
-- 62's definition with two parameters added: p_set_goal says whether to
-- write the goal at all (false leaves it as it is), p_goalid is the goal
-- (null clears it). Written on the Expense leg; the Income leg is always
-- cleared, which the check above requires anyway. The composite FK
-- (userid, goalid) refuses another user's goal, SECURITY DEFINER or not.
-- ---------------------------------------------------------------------
drop function public.update_transfer(uuid, uuid, uuid, numeric, date, text, text, boolean, boolean, timestamptz, boolean, timestamptz);

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
  p_to_anchor_answer_set_at    timestamptz default null,
  p_set_goal                   boolean default false,
  p_goalid                     uuid default null
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

  if (select count(*) from public.accounts
       where id in (p_from_accountid, p_to_accountid) and userid = v_uid) <> 2 then
    raise exception 'update_transfer: account not found' using errcode = 'P0002';
  end if;

  -- The goal is the caller's (the composite FK would refuse it anyway;
  -- this says so in the function's own terms).
  if p_set_goal and p_goalid is not null
     and not exists (select 1 from public.goals where id = p_goalid and userid = v_uid) then
    raise exception 'update_transfer: goal not found' using errcode = 'P0002';
  end if;

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

  update public.transactions
     set accountid = case transaction_type when 'Expense' then p_from_accountid else p_to_accountid end,
         amount = p_amount,
         transaction_date = p_transaction_date,
         description = btrim(p_description),
         notes = nullif(btrim(coalesce(p_notes, '')), ''),
         counts_despite_anchor = case transaction_type
                                   when 'Expense' then coalesce(p_from_counts_despite_anchor, counts_despite_anchor)
                                   else coalesce(p_to_counts_despite_anchor, counts_despite_anchor) end,
         anchor_answer_set_at  = case transaction_type
                                   when 'Expense' then case when p_from_counts_despite_anchor is null
                                                            then anchor_answer_set_at else p_from_anchor_answer_set_at end
                                   else case when p_to_counts_despite_anchor is null
                                             then anchor_answer_set_at else p_to_anchor_answer_set_at end end,
         -- The goal rides on the Expense leg only (migration 69).
         goalid = case
                    when transaction_type <> 'Expense' then null
                    when p_set_goal then p_goalid
                    else goalid
                  end
   where transfer_group_id = p_transfer_group_id and userid = v_uid;

  if p_update_schedule and v_recurringid is not null then
    update public.recurring_transactions
       set amount = p_amount
     where id = v_recurringid and userid = v_uid;
  end if;

  perform set_config('sorrel.transfer_edit', '', true);
end;
$$;

comment on function public.update_transfer(uuid, uuid, uuid, numeric, date, text, text, boolean, boolean, timestamptz, boolean, timestamptz, boolean, uuid) is
  'The only write path for an existing transfer: both legs in one call, so they can''t disagree. From/to/amount/date/description/notes; swapping from and to swaps direction. p_update_schedule also sets the schedule''s amount ("this and future occurrences"). Each leg carries its own pre-anchor answer (p_from_* on the Expense leg, p_to_* on the Income leg; migration 62). p_set_goal writes p_goalid (null clears) on the Expense leg -- the only way to set a goal on an existing transfer (migration 69). SECURITY DEFINER, scoped to auth.uid() (migration 59).';

revoke all on function public.update_transfer(uuid, uuid, uuid, numeric, date, text, text, boolean, boolean, timestamptz, boolean, timestamptz, boolean, uuid) from public, anon;
grant execute on function public.update_transfer(uuid, uuid, uuid, numeric, date, text, text, boolean, boolean, timestamptz, boolean, timestamptz, boolean, uuid) to authenticated;
