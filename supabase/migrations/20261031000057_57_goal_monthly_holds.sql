-- =====================================================================
-- EverNest 57: safe to spend sets aside this month's goal money
--
-- HELD (feat/goal-contributions-in-safe-to-spend). Never push this to the
-- shared sorrel-dev: test it on a throwaway project (CLAUDE.md "A held
-- branch's migration must never be pushed to the shared dev database").
--
-- A goal's monthly_contribution is an intention, not a transaction, so
-- nothing here is written: the hold is derived per request, in
-- v_goal_monthly_holds, and safe to spend subtracts it flat, like the
-- cushion (lib/safeToSpendProjection.ts). It comes off the headline only;
-- it never raises the running-low line, which stays the cushion alone.
--
-- 1. goals.funding_recurringid: the recurring transfer that moves this
--    goal's money automatically, or null. When it's set and that transfer
--    is counted by the projection, the transfer is the commitment and the
--    target holds nothing -- otherwise both would come off. Named by the
--    FK convention (no underscore before "id", like to_accountid); asked
--    for in the same step as the monthly target (GoalForm).
--
-- 2. v_goal_monthly_holds: per goal, what's still to set aside this
--    month -- max(0, monthly target - contributed this month). Per goal,
--    never summed first: one over-funded goal must not cover another.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The funding link
--
-- Composite, like every reference since migration 44: a goal can only
-- point at its own user's schedule. Deleting the schedule nulls the link
-- (and only the link -- the column-list form keeps userid), and the
-- goal's target holds again.
-- ---------------------------------------------------------------------
alter table public.goals
  add column funding_recurringid uuid,
  add constraint goals_funding_recurringid_fkey
      foreign key (userid, funding_recurringid)
      references public.recurring_transactions(userid, id)
      on delete set null (funding_recurringid);

comment on column public.goals.funding_recurringid is
  'The recurring transfer that funds this goal automatically, or null. While that transfer is counted by safe to spend (in v_upcoming_recurring and leaving the spendable set, leaves_spendable_set), it is the commitment and the goal''s monthly_contribution holds nothing; otherwise the target holds (v_goal_monthly_holds). Asked for when the monthly target is set (GoalForm).';

-- ---------------------------------------------------------------------
-- 2. What each goal still holds this month
--
-- Eligible: active (not archived), not completed, a monthly target above
-- zero, and not funded by a counted transfer. "This month" is the user's:
-- current_date is their day inside a request (migration 40), the same
-- month v_goals_summary uses.
--
-- "Funded" is read from what the projection actually counts, not from the
-- link alone: a paused or ended schedule isn't in v_upcoming_recurring,
-- and one moved to Checking -> Cash doesn't leave the set, so either way
-- nothing would come off for it -- the target holds instead, rather than
-- the goal silently holding nothing.
-- ---------------------------------------------------------------------
create view public.v_goal_monthly_holds with (security_invoker = true) as
select g.userid,
       g.id as goalid,
       g.goal_name,
       g.monthly_contribution,
       coalesce(m.contributed, 0::numeric) as contributed_this_month,
       greatest(g.monthly_contribution - coalesce(m.contributed, 0::numeric), 0::numeric) as still_to_set_aside
  from public.goals g
  left join lateral (
    select sum(gc.amount) as contributed
      from public.goal_contributions gc
     where gc.goalid = g.id
       and gc.date >= date_trunc('month', current_date::timestamptz)::date
       and gc.date < (date_trunc('month', current_date::timestamptz) + '1 mon'::interval)::date
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
  'Per goal, this month''s money safe to spend sets aside: max(0, monthly_contribution - contributed this month), for active, uncompleted goals with a monthly target and no counted funding transfer (goals.funding_recurringid). Derived, never stored. Read by getSafeToSpend (lib/db/dashboard.ts); subtracted flat, after the cushion, never raising the running-low line.';

revoke all on table public.v_goal_monthly_holds from public, anon;
grant select on table public.v_goal_monthly_holds to authenticated;
