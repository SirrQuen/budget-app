-- =====================================================================
-- Sorrel 71: "Your month, as a story" -- the figures, read in SQL
--
-- docs/Motion-and-Delight.md, step 9. Rulings 2026-11-16 (batch E).
--
-- month_story(p_month) answers, for the caller and the calendar month
-- p_month falls in, everything the recap shows except safe to spend
-- (which can't be computed for a past date; the recap shows today's
-- figure from getSafeToSpend). Read-only: it stores nothing, creates no
-- view, writes no row. SECURITY INVOKER -- RLS scopes every table it
-- reads -- and it takes no user id: the caller is the user.
--
-- 1. logs: transactions CREATED in the month, in the user's zone, that
--    weren't imported (import_id is null). A transfer is one log (its
--    Expense leg, the canonical row -- migration 69's rule). A
--    confirmation from the queue counts: it is a person's answer. The
--    month is read in the user's CURRENT zone (settings.timezone),
--    accepted by ruling: someone who has travelled can see a log near
--    midnight on the neighbouring day.
--
-- 2. goals: per active, manual goal, its goal money (v_goal_money, 69)
--    DATED in the month -- hand entries and linked transactions. Left out:
--    archived goals (as v_goals_summary does), goals that follow a card
--    (their old entries don't count toward them; item 3 covers them), and
--    'carried_over' contributions, which are the bookkeeping an unlink
--    writes (70), not money set aside. Ordered largest first; ties by the
--    most recent entry, then name. pct_by_month_end is the goal's meter as
--    of the month's last day: all its goal money dated on or before it
--    (carried_over included -- it IS progress) over the target, capped at
--    100. goal_total is the sum of the month's amounts, in SQL.
--
-- 3. cards: per active goal that follows a card, what the card's debt
--    went down by over the month: owed at the start (balance as of the day
--    before the month) minus owed at the end (as of its last day), both
--    through account_balance_as_of() -- counts_in_balance() with p_as_of
--    set to that day (70). Only when positive. Left out when the card's
--    balance date (opening_date) is inside or after the month: the
--    "start" would then be a balance entered later, not what was owed.
--    The figure is net: new charges and refunds in the month are in it.
--
-- 4. user_time_zone(): the zone rule user_day() carried inline (70), now
--    one function both read, so the month's bounds and a trigger's day
--    can't disagree. user_day() is redefined on it; its grants stand.
--
-- Known gap, by ruling: confirmed occurrences of a goal-funding schedule
-- aren't linked to the goal yet (queued), so that money isn't in item 2.
--
-- Grants: the full block -- revoke from all four roles, then grant
-- execute to exactly who calls it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The user's zone, once
-- ---------------------------------------------------------------------
create function public.user_time_zone(p_userid uuid)
returns text
language sql
stable
security invoker
set search_path to ''
as $$
  select coalesce(
           (select s.timezone
              from public.settings s
             where s.userid = p_userid
               and s.timezone in (select name from pg_catalog.pg_timezone_names)),
           'UTC');
$$;

comment on function public.user_time_zone(uuid) is
  'The user''s IANA zone from settings.timezone, or UTC when unset or unknown to Postgres -- apply_user_timezone()''s fallback. THE zone rule for code that names the zone explicitly: user_day() and month_story() read it (migration 71).';

revoke all on function public.user_time_zone(uuid) from public, anon, authenticated, service_role;
grant execute on function public.user_time_zone(uuid) to authenticated, service_role;

create or replace function public.user_day(p_userid uuid, p_at timestamptz)
returns date
language sql
stable
security invoker
set search_path to ''
as $$
  select (p_at at time zone public.user_time_zone(p_userid))::date;
$$;

comment on function public.user_day(uuid, timestamptz) is
  'The user''s calendar day for an instant, in user_time_zone() (settings.timezone; UTC when unset or unknown). For triggers, which can run outside a request (migrations 70, 71).';

-- ---------------------------------------------------------------------
-- 2. month_story()
-- ---------------------------------------------------------------------
create function public.month_story(p_month date)
returns table (
  month_start date,
  logs        integer,
  goal_total  numeric,
  goals       jsonb,
  cards       jsonb
)
language sql
stable
security invoker
set search_path to ''
as $$
  with m as (
    select date_trunc('month', p_month::timestamp)::date                        as m0,
           (date_trunc('month', p_month::timestamp) + interval '1 month')::date as m1,
           public.user_time_zone(auth.uid())                                    as tz
  ),
  b as (
    -- The month's first and last instants in the user's zone, so the
    -- created_at filter compares instants (and can use an index).
    select m.m0, m.m1,
           (m.m0::timestamp at time zone m.tz) as from_at,
           (m.m1::timestamp at time zone m.tz) as to_at
      from m
  ),
  logs as (
    select count(*)::integer as n
      from public.transactions t
     cross join b
     where t.import_id is null
       and (t.transfer_group_id is null or t.transaction_type = 'Expense')
       and t.created_at >= b.from_at
       and t.created_at <  b.to_at
  ),
  goal_money as (
    select g.id,
           g.goal_name,
           g.target_amount,
           sum(gm.amount) filter (where gm.date >= b.m0 and gm.date < b.m1
                                    and gc.funding_method is distinct from 'carried_over') as this_month,
           max(gm.date)   filter (where gm.date >= b.m0 and gm.date < b.m1
                                    and gc.funding_method is distinct from 'carried_over') as last_date,
           sum(gm.amount) filter (where gm.date < b.m1)                                    as saved_by_end
      from public.goals g
     cross join b
      join public.v_goal_money gm on gm.goalid = g.id
      left join public.goal_contributions gc on gc.id = gm.contribution_id
     where g.is_active
       and g.tracking_method <> 'LinkedAccount'
     group by g.id, g.goal_name, g.target_amount
  ),
  goals as (
    select * from goal_money where this_month > 0
  ),
  cards as (
    select g.id as goal_id,
           a.account_name,
           public.account_balance_as_of(a.id, b.m1 - 1)
             - public.account_balance_as_of(a.id, b.m0 - 1) as paid_down
      from public.goals g
      join public.accounts a on a.id = g.accountid
     cross join b
     where g.is_active
       and g.tracking_method = 'LinkedAccount'
       and a.opening_date <= b.m0 - 1
  )
  select b.m0,
         logs.n,
         coalesce((select sum(x.this_month) from goals x), 0::numeric),
         coalesce((select jsonb_agg(jsonb_build_object(
                            'goal_id',          x.id,
                            'name',             x.goal_name,
                            'amount',           x.this_month,
                            'pct_by_month_end', round(least(x.saved_by_end / x.target_amount, 1::numeric) * 100, 1))
                          order by x.this_month desc, x.last_date desc, x.goal_name)
                     from goals x), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                            'goal_id',   c.goal_id,
                            'card_name', c.account_name,
                            'amount',    c.paid_down)
                          order by c.paid_down desc, c.account_name)
                     from cards c
                    where c.paid_down > 0), '[]'::jsonb)
    from b
   cross join logs;
$$;

comment on function public.month_story(date) is
  'The month recap''s figures for the caller and the month p_month falls in (migration 71): logs (created that month in the user''s zone, not imported, one per transfer), goals (active manual goals'' goal money dated that month, carried_over excluded, largest first, with the meter as of month end), goal_total, and cards (followed cards whose debt went down over the month, when the card''s balance date is before it). Read-only, SECURITY INVOKER, no user id.';

revoke all on function public.month_story(date) from public, anon, authenticated, service_role;
grant execute on function public.month_story(date) to authenticated;
