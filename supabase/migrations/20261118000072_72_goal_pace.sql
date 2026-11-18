-- =====================================================================
-- Sorrel 72: goal pace -- when a goal blooms, at the pace it's growing
--
-- docs/Decide-and-Grow.md, section H. Rulings on Phase 1 for H,
-- 2026-11-17.
--
-- goal_pace() answers, per active goal of the caller, the history-based
-- pace and what it implies. Read-only: it stores nothing, creates no
-- view, writes no row. SECURITY INVOKER -- RLS scopes every table and
-- view it reads -- and it takes no user id: the caller is the user.
-- STABLE: it reads current_date, which inside a request is the user's
-- day (apply_user_timezone(), migration 40).
--
-- The window is the last 3 COMPLETE calendar months: the three months
-- before the one today falls in. Keyed on money dates, never on when a
-- row was entered.
--
-- 1. Saving goals (not following a card): goal money (v_goal_money, 69,
--    the one source) dated in the window, 'carried_over' excluded -- it's
--    the bookkeeping an unlink writes (70), not money set aside, the same
--    exclusion month_story() makes (71). Enough history = money in at
--    least 2 of the 3 months. Pace = the window's total / 3, always 3:
--    a month with nothing in it is part of the pace.
--
-- 2. Debt goals that follow a card: pace = what the card owed at the
--    start of the window minus what it owes at the end, / 3 -- month-end
--    balances through account_balance_as_of() (counts_in_balance() with
--    p_as_of set to that day, 70). The recap's balance-date rule (71):
--    the card's balance date (opening_date) must be on or before the day
--    before the window, or the "start" would be a balance entered later,
--    not what was owed -- until then, not enough history. A pace that
--    isn't positive is no pace (the card owes the same or more): state
--    'no_pace', and the card shows no line.
--
-- 3. What it implies, for a positive pace:
--      bloom_month   = this month + ceil(remaining / pace) months
--      target_month  = the target date's month, only while that month is
--                      still ahead. A target date already past -- or in
--                      the month today is in, which no bloom month can
--                      reach -- is treated as no date. Never "missed".
--      on_pace       = bloom_month <= target_month
--      needed_monthly = when not on pace: remaining / the months from
--                      now to the target month, rounded UP to $10.
--    remaining is v_goal_progress.remaining_amount -- the card's owed
--    amount for a followed goal -- so the meter and the pace agree.
--
-- state: 'complete' (reached or paid off -- no line), 'not_enough'
-- (too little history), 'no_pace' (a followed card owing the same or
-- more), 'pace'. The app turns these into words; it computes no money.
--
-- Grants: the full block -- revoke from all four roles, then grant
-- execute to exactly who calls it.
-- =====================================================================

create function public.goal_pace()
returns table (
  goal_id           uuid,
  follows_card      boolean,
  state             text,
  months_with_money integer,
  pace              numeric,
  remaining         numeric,
  bloom_month       date,
  target_month      date,
  on_pace           boolean,
  needed_monthly    numeric
)
language sql
stable
security invoker
set search_path to ''
as $$
  with w as (
    select date_trunc('month', current_date::timestamp)::date                       as m_now,
           (date_trunc('month', current_date::timestamp) - interval '3 months')::date as w0
  ),
  goals as (
    select g.id,
           g.tracking_method = 'LinkedAccount'                                    as follows_card,
           g.accountid,
           g.target_date,
           p.remaining_amount                                                     as remaining,
           (g.completed_at is not null
              or coalesce(p.is_paid_off, false)
              or p.remaining_amount <= 0)                                         as complete
      from public.goals g
      join public.v_goal_progress p on p.goal_id = g.id
     where g.is_active
  ),
  saving as (
    -- Per goal, the window's money by month (carried_over excluded).
    select x.goalid,
           count(*) filter (where x.month_total > 0)::integer as months_with_money,
           coalesce(sum(x.month_total), 0::numeric)           as total
      from (
        select gm.goalid,
               date_trunc('month', gm.date::timestamp) as m,
               sum(gm.amount)                          as month_total
          from public.v_goal_money gm
          left join public.goal_contributions gc on gc.id = gm.contribution_id
         cross join w
         where gm.date >= w.w0
           and gm.date <  w.m_now
           and gc.funding_method is distinct from 'carried_over'
         group by gm.goalid, date_trunc('month', gm.date::timestamp)
      ) x
     group by x.goalid
  ),
  paced as (
    select g.id,
           g.follows_card,
           g.target_date,
           g.remaining,
           g.complete,
           s.months_with_money,
           case
             when g.follows_card then coalesce(a.opening_date <= w.w0 - 1, false)
             else coalesce(s.months_with_money, 0) >= 2
           end as enough,
           case
             when g.follows_card and a.opening_date <= w.w0 - 1
               -- Balances are stored negative for a liability: the later
               -- balance minus the earlier is how far the debt went down.
               then (public.account_balance_as_of(a.id, w.m_now - 1)
                     - public.account_balance_as_of(a.id, w.w0 - 1)) / 3
             when not g.follows_card and coalesce(s.months_with_money, 0) >= 2
               then s.total / 3
           end as pace
      from goals g
     cross join w
      left join saving s on s.goalid = g.id
      left join public.accounts a on g.follows_card and a.id = g.accountid
  ),
  dated as (
    select p.*,
           case when p.pace > 0 and not p.complete
                then (w.m_now + (ceil(p.remaining / p.pace)::integer * interval '1 month'))::date
           end as bloom_month,
           case when p.target_date is not null
                 and date_trunc('month', p.target_date::timestamp)::date > w.m_now
                then date_trunc('month', p.target_date::timestamp)::date
           end as target_month,
           w.m_now
      from paced p
     cross join w
  )
  select d.id,
         d.follows_card,
         case
           when d.complete       then 'complete'
           when not d.enough     then 'not_enough'
           when d.pace <= 0      then 'no_pace'
           else 'pace'
         end,
         d.months_with_money,
         case when not d.complete and d.pace > 0 then round(d.pace, 2) end,
         d.remaining,
         d.bloom_month,
         d.target_month,
         case when d.bloom_month is not null and d.target_month is not null
              then d.bloom_month <= d.target_month end,
         case when d.bloom_month is not null
               and d.target_month is not null
               and d.bloom_month > d.target_month
              then ceil(d.remaining
                        / ((extract(year from d.target_month) - extract(year from d.m_now)) * 12
                           + extract(month from d.target_month) - extract(month from d.m_now))
                        / 10) * 10
         end
    from dated d;
$$;

comment on function public.goal_pace() is
  'Per active goal of the caller (migration 72): the history pace over the last 3 complete months -- goal money (v_goal_money, carried_over excluded) / 3 with money in at least 2 of them, or for a goal following a card the drop in what it owes by month-end balances (account_balance_as_of, the recap''s balance-date rule) / 3, positive only -- and what it implies: bloom_month, target_month (null when none, past, or this month), on_pace, needed_monthly (rounded up to $10). state: complete | not_enough | no_pace | pace. Read-only, STABLE, SECURITY INVOKER, no user id.';

revoke all on function public.goal_pace() from public, anon, authenticated, service_role;
grant execute on function public.goal_pace() to authenticated;
