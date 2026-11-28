-- =====================================================================
-- Which goal holds migration 82 moves (READ-ONLY)
--
--   npx supabase db query --remote=<ref> --read-only -f docs/goal-hold-netting-check.sql
--
-- Reads only; safe on production. Run it BEFORE the 82 push and the
-- deploy (it reads the old link, goals.funding_recurringid, which 82
-- backfills one-for-one), so it compares what the hero holds today with
-- what it will hold once the new app nets.
--
-- Today (57/69/70): a goal funded by a counted recurring transfer holds
-- $0. After 82: it holds min(max(monthly - goal money this month - this
-- month's occurrences of its schedule that the projection subtracts, 0),
-- what's left). Unfunded goals don't move: netting subtracts nothing.
--
-- APPROXIMATE in two ways, both said here rather than hidden:
--   - occurrences are stepped from the schedule's cursor without the
--     business-day shift the projection applies (expandOccurrences); a
--     due date that a weekend pushes across a month end is miscounted;
--   - current_date is UTC here (no request, no apply_user_timezone()), so
--     on the first or last day of a month a user west or east of UTC can
--     land in the other month.
-- The exact figure is the app's own (the hero breakdown). Columns are ids
-- and amounts only -- no names.
-- =====================================================================
with month as (
  select date_trunc('month', current_date)::date as m0,
         (date_trunc('month', current_date) + interval '1 month')::date as m1
),
funded as (
  select g.id as goal_id, g.userid, g.monthly_contribution as monthly, g.funding_recurringid as recurring_id,
         -- v_goal_progress.remaining_amount for a manual goal, restated
         -- because the --read-only role can't execute counts_in_balance(),
         -- which that view reaches through v_account_balances.
         greatest(g.target_amount - coalesce((select sum(gm.amount) from public.v_goal_money gm where gm.goalid = g.id), 0), 0)
           as remaining,
         coalesce((select sum(gm.amount) from public.v_goal_money gm, month
                    where gm.goalid = g.id and gm.date >= month.m0 and gm.date < month.m1), 0) as in_this_month
    from public.goals g
   where g.is_active
     and g.completed_at is null
     and g.tracking_method <> 'LinkedAccount'
     and g.monthly_contribution > 0
     and g.funding_recurringid is not null
),
-- From the base tables: the --read-only role can execute none of the
-- app's functions, so v_upcoming_recurring (recurring_is_finished()) and
-- leaves_spendable_set() are out of reach. The set is restated here, for
-- this diagnostic only -- is_spendable_account_type() (migration 47/54):
-- Checking and Cash. Never copy this into app SQL.
schedule as (
  select r.id as recurring_id, r.next_run_date, r.next_due_date, r.frequency, coalesce(r.interval_count, 1) as n,
         r.end_date,
         case when r.occurrence_limit is null then null
              else r.occurrence_limit - (select count(distinct coalesce(t.transfer_group_id, t.id))
                                           from public.transactions t where t.recurringid = r.id) end
           as occurrences_remaining,
         r.amount as counted,
         (fa.account_type in ('Checking', 'Cash') and ta.account_type not in ('Checking', 'Cash'))
           as counted_by_projection
    from public.recurring_transactions r
    join public.accounts fa on fa.id = r.accountid
    join public.accounts ta on ta.id = r.to_accountid
   where r.is_active
     and r.to_accountid is not null
),
occ as (
  -- k = 0 is the stored next occurrence (its real due date); later ones
  -- step the cursor.
  select s.recurring_id, s.counted,
         case when k = 0 then s.next_due_date
              when s.frequency in ('Weekly', 'Biweekly')
                then s.next_run_date + (k * 7 * case when s.frequency = 'Biweekly' then 2 else s.n end)
              when s.frequency = 'Daily' then s.next_run_date + k * s.n
              when s.frequency = 'Quarterly' then (s.next_run_date + make_interval(months => 3 * k))::date
              when s.frequency = 'Yearly' then (s.next_run_date + make_interval(years => k))::date
              else (s.next_run_date + make_interval(months => k * s.n))::date
         end as due,
         case when k = 0 then s.next_run_date
              when s.frequency in ('Weekly', 'Biweekly')
                then s.next_run_date + (k * 7 * case when s.frequency = 'Biweekly' then 2 else s.n end)
              when s.frequency = 'Daily' then s.next_run_date + k * s.n
              when s.frequency = 'Quarterly' then (s.next_run_date + make_interval(months => 3 * k))::date
              when s.frequency = 'Yearly' then (s.next_run_date + make_interval(years => k))::date
              else (s.next_run_date + make_interval(months => k * s.n))::date
         end as cursor_date,
         k, s.end_date, s.occurrences_remaining
    from schedule s
   cross join generate_series(0, 40) k
   where s.counted_by_projection
),
scheduled as (
  select o.recurring_id, sum(o.counted) as this_month
    from occ o, month
   where o.due >= month.m0 and o.due < month.m1
     and (o.end_date is null or o.cursor_date <= o.end_date)
     and (o.occurrences_remaining is null or o.k < o.occurrences_remaining)
   group by o.recurring_id
),
compared as (
  select f.goal_id, f.userid, f.monthly, f.in_this_month, f.remaining,
         coalesce(sc.this_month, 0) as scheduled_this_month,
         -- Today's hold (57/69/70): 0 while the funding transfer is
         -- counted, else the target less this month's money, capped.
         case when exists (select 1 from schedule s where s.recurring_id = f.recurring_id and s.counted_by_projection)
              then 0
              else least(greatest(f.monthly - f.in_this_month, 0), f.remaining) end as hold_now,
         least(greatest(f.monthly - f.in_this_month - coalesce(sc.this_month, 0), 0), f.remaining) as hold_after_82
    from funded f
    left join scheduled sc on sc.recurring_id = f.recurring_id
)
select left(goal_id::text, 8) as goal, left(userid::text, 8) as user_, monthly, in_this_month,
       scheduled_this_month, hold_now, hold_after_82, hold_after_82 - hold_now as hold_change  -- safe to spend moves the other way
  from compared
 where hold_after_82 <> hold_now
union all
select 'TOTAL', count(distinct userid)::text || ' users', null, null, null,
       sum(hold_now), sum(hold_after_82), sum(hold_after_82 - hold_now)
  from compared
 where hold_after_82 <> hold_now
 order by 1;
