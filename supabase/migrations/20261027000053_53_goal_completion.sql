-- =====================================================================
-- EverNest 53: goal completion and archive
--
-- 1. goals.completed_at -- when the goal's contributions first reached
--    its target. History and the completed resting state on /goals. It
--    does NOT drive the celebration: that is part of the response to the
--    server action that completed the goal (docs/Goal-Completion.md, D),
--    which compares completed_at before and after its own write.
--
--    The database keeps it true, on every path, so no action can forget:
--    - a contribution added, edited or deleted (AFTER trigger on
--      goal_contributions) re-derives it for that goal;
--    - any UPDATE of a goal (BEFORE trigger) re-derives it from OLD, so a
--      lowered or raised target counts, and a client can't write it.
--    Reaching the target keeps the first completion's timestamp; falling
--    below it clears the column -- silently. Re-completing stamps anew.
--
--    When linked goals land (migration 52, held), a linked goal's
--    progress is an account balance, not contributions, and these
--    triggers don't see it change. Completion then belongs to whatever
--    action moves that balance -- never to a render.
--
-- 2. goals.is_active -- Archive. The same soft-delete convention as
--    accounts and categories (is_active boolean), not a second one.
--    Archived goals leave the goals list, "Saved toward your goals" and
--    the dashboard. Their contributions are untouched: archiving is not
--    deleting. (goals.status, Active/Paused/Completed/Cancelled, predates
--    this and nothing writes it; it is not used for archive or completion.)
--
-- v_goal_progress is NOT redefined here: migration 52 (held, but applied
-- to sorrel-dev) redefines it with columns this migration doesn't have,
-- and CREATE OR REPLACE can't drop them. The app reads completed_at and
-- is_active from goals directly (lib/db/dashboard.ts getGoalProgress).
-- v_goals_summary, which 52 doesn't touch, is replaced to skip archived
-- goals -- money is summed in SQL, so the filter has to be here.
-- =====================================================================

alter table public.goals
  add column completed_at timestamptz,
  add column is_active boolean not null default true;

comment on column public.goals.completed_at is
  'When contributions first reached target_amount; null while below it. Maintained by triggers (migration 53) -- never written by the app. Not the celebration trigger: see docs/Goal-Completion.md.';
comment on column public.goals.is_active is
  'false = archived (the accounts/categories convention). Contributions are kept.';

-- ---------------------------------------------------------------------
-- 1. The rule, once
-- ---------------------------------------------------------------------

-- What completed_at should be for a goal with this target, given what it
-- is now. security invoker: RLS scopes the contributions read.
create or replace function public.goal_completed_at(p_goal_id uuid, p_target numeric, p_current timestamptz)
returns timestamptz
language sql
stable
security invoker
set search_path to ''
as $$
  select case
    when coalesce((select sum(gc.amount) from public.goal_contributions gc where gc.goalid = p_goal_id), 0)
         >= p_target
      then coalesce(p_current, now())
    else null
  end;
$$;

comment on function public.goal_completed_at(uuid, numeric, timestamptz) is
  'completed_at for a goal: kept while contributions >= target, now() on first reaching it, null below it.';

-- ---------------------------------------------------------------------
-- 2. Backfill, before the triggers exist
--
-- Goals already at target get the day their running total crossed it,
-- as an instant in the user's zone (migration 48's pattern): migrations
-- run in UTC, and a date cast here would be UTC's day, not the user's.
-- The backfill is not an edit: updated_at stays as it was.
-- ---------------------------------------------------------------------
alter table public.goals disable trigger trg_goals_updated_at;

with running as (
  select gc.goalid,
         gc.date,
         sum(gc.amount) over (partition by gc.goalid order by gc.date, gc.created_at
                              rows between unbounded preceding and current row) as total
    from public.goal_contributions gc
),
crossed as (
  select g.id,
         min(r.date) as crossed_on,
         coalesce(
           (select s.timezone
              from public.settings s
             where s.userid = g.userid
               and s.timezone in (select name from pg_timezone_names)),
           'UTC') as tz
    from public.goals g
    join running r on r.goalid = g.id and r.total >= g.target_amount
   group by g.id, g.userid
)
update public.goals g
   set completed_at = crossed.crossed_on::timestamp at time zone crossed.tz
  from crossed
 where crossed.id = g.id;

alter table public.goals enable trigger trg_goals_updated_at;

-- ---------------------------------------------------------------------
-- 3. Triggers
-- ---------------------------------------------------------------------

-- Every goal UPDATE re-derives completed_at from OLD: a target edit
-- counts, and a client-supplied completed_at is ignored.
create or replace function public.goals_sync_completed_at()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  new.completed_at := public.goal_completed_at(new.id, new.target_amount, old.completed_at);
  return new;
end;
$$;

create trigger trg_goals_completed_at
  before update on public.goals
  for each row execute function public.goals_sync_completed_at();

-- A contribution change re-derives its goal's completed_at, writing only
-- when it actually changes (so updated_at moves only on a real change).
-- Deleting a goal cascades to its contributions; by then the goal row is
-- gone, so the update below matches nothing.
create or replace function public.goal_contributions_sync_completed_at()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_goal_id uuid := case when tg_op = 'DELETE' then old.goalid else new.goalid end;
begin
  update public.goals g
     set completed_at = public.goal_completed_at(g.id, g.target_amount, g.completed_at)
   where g.id = v_goal_id
     and g.completed_at is distinct from public.goal_completed_at(g.id, g.target_amount, g.completed_at);

  -- An edit can't move a contribution between goals today, but if one
  -- ever does, the goal it left is re-derived too.
  if tg_op = 'UPDATE' and old.goalid is distinct from new.goalid then
    update public.goals g
       set completed_at = public.goal_completed_at(g.id, g.target_amount, g.completed_at)
     where g.id = old.goalid
       and g.completed_at is distinct from public.goal_completed_at(g.id, g.target_amount, g.completed_at);
  end if;

  return null;
end;
$$;

create trigger trg_goal_contributions_completed_at
  after insert or update or delete on public.goal_contributions
  for each row execute function public.goal_contributions_sync_completed_at();

-- ---------------------------------------------------------------------
-- 4. v_goals_summary skips archived goals
--
-- Same columns, same order, same security_invoker; only archived goals
-- are filtered out, joined from goals because v_goal_progress doesn't
-- carry is_active (see the header).
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
  join public.goals active on active.id = g.goal_id and active.is_active
  left join lateral (
    select sum(gc.amount) as contributed_this_month
      from public.goal_contributions gc
      join public.goals g2 on g2.id = gc.goalid
     where g2.userid = g.userid
       and g2.is_active
       and gc.date >= date_trunc('month', current_date::timestamptz)::date
       and gc.date < (date_trunc('month', current_date::timestamptz) + '1 mon'::interval)::date
  ) m on true
 group by g.userid, m.contributed_this_month;
