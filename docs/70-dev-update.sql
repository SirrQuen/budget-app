-- =====================================================================
-- DEV ONLY: bring sorrel-dev up to migration 70 as edited on 2026-11-17
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/70-dev-update.sql
--
-- 70 was pushed to sorrel-dev before Matt's rulings of 2026-11-17, and the
-- file was then edited. `db push` never re-applies a version it has
-- recorded, so this file applies the edited statements in place. Every one
-- is CREATE OR REPLACE (the view only gains a column at the end), so dev
-- ends with exactly the schema the edited 70 creates. Production has never
-- had 70 and gets the edited file by `db push`; never run this there.
--
-- What changed in 70:
--   - sync_card_goal_completion(): also filters on auth.uid() (beside
--     RLS); comments.
--   - transactions_sync_card_goals(): an INSERT dated on or before the
--     completion day re-assesses it, like an edit or delete.
--   - v_goal_progress: is_paid_off appended; the meter is 100% only when
--     paid off (completed, or owing nothing before completed_at is
--     written), and stops at 99.9% while anything is owed.
-- =====================================================================

begin;

create or replace function public.sync_card_goal_completion(p_goal_id uuid, p_touched date[], p_reassess boolean)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_goal    record;
  v_today   date;
  v_done_on date;
  v_next    timestamptz;
begin
  -- Scoped to the caller twice over: security invoker, so RLS hides
  -- another user's goal; and explicitly to auth.uid(). auth.uid() is null
  -- only outside a signed-in request (the table owner, service role
  -- scripts), where there is no caller to scope to.
  select g.id, g.userid, g.accountid, g.completed_at
    into v_goal
    from public.goals g
   where g.id = p_goal_id
     and g.tracking_method = 'LinkedAccount'
     and (auth.uid() is null or g.userid = auth.uid());
  if not found then
    return;
  end if;

  v_today := public.user_day(v_goal.userid, now());
  v_next := v_goal.completed_at;

  if v_goal.completed_at is null then
    if public.account_balance_as_of(v_goal.accountid, v_today) >= 0 then
      v_next := now();
    end if;
  elsif p_reassess then
    v_done_on := public.user_day(v_goal.userid, v_goal.completed_at);
    -- Only a change to the card's history up to the completion day.
    if exists (select 1 from unnest(p_touched) d where d is not null and d <= v_done_on)
       and public.account_balance_as_of(v_goal.accountid, v_done_on) < 0 then
      v_next := case
                  when public.account_balance_as_of(v_goal.accountid, v_today) >= 0 then now()
                  else null
                end;
    end if;
  end if;

  if v_next is distinct from v_goal.completed_at then
    perform set_config('sorrel.goal_completion', 'on', true);
    update public.goals set completed_at = v_next where id = v_goal.id;
    perform set_config('sorrel.goal_completion', '', true);
  end if;
end;
$$;

comment on function public.sync_card_goal_completion(uuid, date[], boolean) is
  'A goal following a card: completes when a write leaves the card owing nothing as of the user''s today. Sticky: re-assessed only when p_reassess (any insert, edit or delete of a card transaction) touched a transaction dated on or before the completion day -- kept if the card owed nothing as of that day, else cleared (and completed again today if it owes nothing now). Acts for auth.uid() only (and RLS); search_path pinned. Migration 70.';

-- The trigger functions call it as the user, so the user needs EXECUTE.
-- Called directly it only ever re-derives the truth for the caller's own
-- goals (RLS scopes the read and the write).
revoke all on function public.sync_card_goal_completion(uuid, date[], boolean) from public, anon;
grant execute on function public.sync_card_goal_completion(uuid, date[], boolean) to authenticated;

create or replace function public.transactions_sync_card_goals()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_goal_id uuid;
  v_touched date[] := array[
    case when tg_op in ('UPDATE', 'DELETE') then old.transaction_date end,
    case when tg_op in ('INSERT', 'UPDATE') then new.transaction_date end
  ];
begin
  for v_goal_id in
    select g.id
      from public.goals g
     where g.tracking_method = 'LinkedAccount'
       and g.accountid in (
         case when tg_op in ('UPDATE', 'DELETE') then old.accountid end,
         case when tg_op in ('INSERT', 'UPDATE') then new.accountid end)
  loop
    perform public.sync_card_goal_completion(v_goal_id, v_touched, true);
  end loop;
  return null;
end;
$$;

comment on function public.transactions_sync_card_goals() is
  'AFTER INSERT/UPDATE/DELETE on transactions: a write on a card a goal follows syncs that goal''s completion (sync_card_goal_completion): it can complete it, and a row dated on or before the completion day re-assesses it (migration 70).';

revoke all on function public.transactions_sync_card_goals() from public, anon, authenticated;

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
    p.contributed AS contributed_amount,
    p.remaining AS remaining_amount,
    round((p.ratio * (100)::numeric), 1) AS pct_complete,
    COALESCE(c.contribution_count, (0)::bigint) AS contribution_count,
    c.last_contribution_date,
        CASE
            WHEN (p.remaining <= (0)::numeric) THEN CURRENT_DATE
            WHEN (g.monthly_contribution > (0)::numeric) THEN ((CURRENT_DATE + ((ceil((p.remaining / g.monthly_contribution)))::double precision * '1 mon'::interval)))::date
            ELSE NULL::date
        END AS projected_completion_date,
        CASE
            WHEN (g.target_date IS NULL) THEN NULL::boolean
            WHEN (p.remaining <= (0)::numeric) THEN true
            WHEN (g.monthly_contribution > (0)::numeric) THEN (((CURRENT_DATE + ((ceil((p.remaining / g.monthly_contribution)))::double precision * '1 mon'::interval)))::date <= g.target_date)
            ELSE false
        END AS is_on_track,
    g.completed_at,
    g.is_active,
    g.starting_balance,
    p.owed AS owed_amount,
    b.account_name AS linked_account_name,
    g.linked_at,
    o.paid_off AS is_paid_off
   FROM public.goals g
     LEFT JOIN LATERAL ( SELECT sum(m.amount) AS contributed,
            count(*) AS contribution_count,
            max(m.date) AS last_contribution_date
           FROM public.v_goal_money m
          WHERE (m.goalid = g.id)) c ON (true)
     LEFT JOIN public.v_account_balances b
       ON (g.tracking_method = 'LinkedAccount' AND b.account_id = g.accountid)
     CROSS JOIN LATERAL ( SELECT
            CASE
              WHEN g.tracking_method <> 'LinkedAccount' THEN NULL::numeric
              ELSE -COALESCE(b.balance, (0)::numeric)
            END AS owed,
            CASE
              WHEN g.tracking_method <> 'LinkedAccount' THEN NULL::boolean
              ELSE (g.completed_at IS NOT NULL OR -COALESCE(b.balance, (0)::numeric) <= (0)::numeric)
            END AS paid_off ) o
     CROSS JOIN LATERAL ( SELECT
            o.owed,
            CASE
              WHEN g.tracking_method <> 'LinkedAccount' THEN COALESCE(c.contributed, (0)::numeric)
              WHEN o.paid_off THEN g.starting_balance
              ELSE GREATEST(LEAST(g.starting_balance - o.owed, g.starting_balance), (0)::numeric)
            END AS contributed,
            CASE
              WHEN g.tracking_method <> 'LinkedAccount'
                THEN GREATEST((g.target_amount - COALESCE(c.contributed, (0)::numeric)), (0)::numeric)
              WHEN o.paid_off THEN (0)::numeric
              ELSE GREATEST(o.owed, (0)::numeric)
            END AS remaining,
            CASE
              WHEN g.tracking_method <> 'LinkedAccount'
                THEN LEAST((COALESCE(c.contributed, (0)::numeric) / NULLIF(g.target_amount, (0)::numeric)), (1)::numeric)
              WHEN o.paid_off THEN (1)::numeric
              -- Owing anything at all, the meter stops short of 100%:
              -- 100% means paid off.
              ELSE LEAST(GREATEST(((g.starting_balance - o.owed) / g.starting_balance), (0)::numeric), 0.999)
            END AS ratio ) p;

comment on view public.v_goal_progress is
  'Per goal: progress from its goal money (v_goal_money, 69) -- or, for a debt payoff goal following a card (migration 70), from the card: owed_amount is what it owes now, remaining_amount the amount to go, pct_complete (starting_balance - owed) / starting_balance clamped 0..100. is_paid_off: completed, or owing nothing before completed_at is written -- the only state at 100%.';

revoke all on table public.v_goal_progress from public, anon, authenticated, service_role;
grant select, references, trigger, truncate, maintain on table public.v_goal_progress to authenticated;
grant references, trigger, truncate, maintain on table public.v_goal_progress to service_role;

commit;
