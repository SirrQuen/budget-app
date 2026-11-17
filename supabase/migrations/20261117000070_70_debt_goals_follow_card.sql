-- =====================================================================
-- Sorrel 70: a debt payoff goal can follow a credit card or loan
--
-- docs/Log-Again-and-Goal-Links.md, section 2. Rulings 2026-11-16.
-- Re-derived on top of 53, 57 and 69; held 52 (feat/linked-goals) was
-- read for reference only and is not merged.
--
-- Why: a debt goal whose TARGET followed the card while payments still
-- counted as contributions would count every payment twice (the payment
-- lowers the target AND raises progress). So the card balance is the
-- whole measure, not just the target.
--
-- 1. is_liability_account_type(type): THE list of liability account
--    types in SQL -- Credit Card or Loan -- the twin of
--    isLiabilityAccountType() (lib/accountOptions.ts). Checked against the
--    TS side by `npm run test:parity`. Nothing else in SQL lists them.
--
-- 2. A goal FOLLOWS a card: tracking_method = 'LinkedAccount', accountid
--    = the card, starting_balance = what it owed (positive) at the moment
--    of linking, linked_at = when. Written only by link_goal_to_card() and
--    unlink_goal_from_card() (and the account trigger below, through
--    unlink); a guard trigger refuses any other write to those columns.
--    Debt Payoff only, a liability only, owing something at link time.
--
-- 3. DERIVED ON READ. v_goal_progress reads the card's balance from
--    v_account_balances on every read:
--      owed now   = -balance (liabilities are stored negative)
--      to go      = greatest(owed now, 0)
--      progress   = starting_balance - owed now
--      meter      = progress / starting_balance, clamped 0..100%
--    starting_balance is recorded once and never recomputed, or the meter
--    would reset whenever someone looked. A followed goal writes no
--    contribution rows; contributions to it, and transactions linked to
--    it (69's goalid), are refused while it follows a card. Contributions
--    and linked transactions it already had stay in its history,
--    uncounted, and count again if it's unlinked.
--
-- 4. COMPLETION IS STICKY, AND WRITE-DRIVEN. completed_at for a followed
--    goal is set by the write that leaves the card owing nothing as of the
--    user's today (account_balance_as_of(card, today) >= 0). After that:
--      - new activity dated AFTER the completion day never clears it;
--      - an EDIT or DELETE of a card transaction dated ON OR BEFORE the
--        completion day re-assesses it: still owing nothing as of that
--        day (counts_in_balance with p_as_of = the completion day) keeps
--        it; otherwise it clears -- and if the card owes nothing today,
--        it completes again, today.
--    No page render writes any of it. The completion day is completed_at
--    in the user's zone (user_day), named explicitly because triggers can
--    run outside a request (service role, scripts), where the session
--    zone is UTC.
--    By ruling, a NEW transaction dated on or before the completion day
--    (an insert, not an edit) does not re-assess it.
--
-- 5. Unlinking keeps the number. unlink_goal_from_card() returns the goal
--    to manual and writes the progress made while following as ONE
--    'carried_over' contribution, dated the user's today. The target is
--    set so "to go" is unchanged: target = history + carried over +
--    what's still owed (or, for a paid-off goal, history + the starting
--    balance, so it stays complete). Changing the goal's type, archiving
--    the card, or the card ceasing to be a liability all unlink, through
--    the same function.
--
-- 6. A followed goal holds nothing in safe to spend
--    (v_goal_monthly_holds): payments to a card are already counted in
--    the projection as card-payment obligations or as the transfer
--    itself, so a hold on top would subtract the same money twice.
--
-- Views replaced in place (same columns, new ones appended):
-- v_goal_progress, v_goal_monthly_holds. Both carry migration 57's grant
-- block. Run docs/view-acl-check.sql after the push.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE liability list
-- ---------------------------------------------------------------------
create function public.is_liability_account_type(p_account_type text)
returns boolean
language sql
immutable
parallel safe
set search_path to ''
as $$
  select coalesce(p_account_type in ('Credit Card', 'Loan'), false);
$$;

comment on function public.is_liability_account_type(text) is
  'THE liability account types in SQL: Credit Card or Loan (migration 70). Twin of isLiabilityAccountType() in lib/accountOptions.ts, checked by npm run test:parity. Liability balances are stored negative. Never list the types inline.';

revoke all on function public.is_liability_account_type(text) from public, anon;
grant execute on function public.is_liability_account_type(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. A contribution can be the progress carried over at unlink
-- ---------------------------------------------------------------------
alter table public.goal_contributions
  drop constraint goal_contributions_funding_method_check,
  add constraint goal_contributions_funding_method_check check (
    (funding_method in ('manual', 'carried_over') and transactionid is null)
    or (funding_method = 'transaction' and transactionid is not null)
  );

-- ---------------------------------------------------------------------
-- 3. goals: the followed card's starting point
-- ---------------------------------------------------------------------
alter table public.goals
  add column starting_balance numeric(12,2),
  add column linked_at timestamptz,
  add constraint goals_follows_card_shape check (
    case
      when tracking_method = 'LinkedAccount'
        then goal_type = 'Debt Payoff'
             and accountid is not null
             and starting_balance is not null and starting_balance > 0
             and linked_at is not null
      else starting_balance is null and linked_at is null
    end
  );

comment on column public.goals.starting_balance is
  'A goal that follows a card (tracking_method = LinkedAccount): what the card owed, positive, when it was linked. Set once by link_goal_to_card(); never recomputed (migration 70).';
comment on column public.goals.linked_at is
  'When the goal started following its card (migration 70).';

-- ---------------------------------------------------------------------
-- 4. Two small readers: a user's calendar day, a balance as of a day
-- ---------------------------------------------------------------------

-- The user's calendar day for an instant, in settings.timezone (UTC when
-- unset or unknown -- apply_user_timezone()'s fallback). Named explicitly
-- so a trigger gives the same answer inside a request and outside one.
create function public.user_day(p_userid uuid, p_at timestamptz)
returns date
language sql
stable
security invoker
set search_path to ''
as $$
  select (p_at at time zone coalesce(
            (select s.timezone
               from public.settings s
              where s.userid = p_userid
                and s.timezone in (select name from pg_catalog.pg_timezone_names)),
            'UTC'))::date;
$$;

comment on function public.user_day(uuid, timestamptz) is
  'The user''s calendar day for an instant, in settings.timezone (UTC when unset or unknown). For triggers, which can run outside a request (migration 70).';

revoke all on function public.user_day(uuid, timestamptz) from public, anon;
grant execute on function public.user_day(uuid, timestamptz) to authenticated, service_role;

-- An account's balance as of a day: v_account_balances' sum, with
-- counts_in_balance's p_as_of set to that day instead of today.
create function public.account_balance_as_of(p_account_id uuid, p_as_of date)
returns numeric
language sql
stable
security invoker
set search_path to ''
as $$
  select a.opening_balance + coalesce((
           select sum(public.signed_amount(t.amount, t.transaction_type))
             from public.transactions t
            where t.accountid = a.id
              and public.counts_in_balance(t.transaction_date, t.created_at,
                                           a.opening_date, a.opening_set_at,
                                           t.counts_despite_anchor, t.anchor_answer_set_at,
                                           p_as_of)), 0)
    from public.accounts a
   where a.id = p_account_id;
$$;

comment on function public.account_balance_as_of(uuid, date) is
  'An account''s balance as of p_as_of: opening balance plus every transaction counts_in_balance() counts as of that day. v_account_balances is this with p_as_of = today (migration 70).';

revoke all on function public.account_balance_as_of(uuid, date) from public, anon;
grant execute on function public.account_balance_as_of(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Only the link functions write the link
-- ---------------------------------------------------------------------
create function public.guard_goal_link()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if coalesce(current_setting('sorrel.goal_link', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.tracking_method = 'LinkedAccount' or new.starting_balance is not null or new.linked_at is not null then
      raise exception 'A goal follows a card only through link_goal_to_card().' using errcode = '42501';
    end if;
  elsif new.tracking_method is distinct from old.tracking_method
     or new.starting_balance is distinct from old.starting_balance
     or new.linked_at is distinct from old.linked_at
     or (old.tracking_method = 'LinkedAccount' and new.accountid is distinct from old.accountid) then
    raise exception 'A goal follows a card only through link_goal_to_card(), and stops through unlink_goal_from_card().'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_goal_link() is
  'BEFORE INSERT OR UPDATE on goals: refuses any write to the follow-a-card columns (tracking_method, starting_balance, linked_at, and a followed goal''s accountid) unless link_goal_to_card() / unlink_goal_from_card() opened the gate (sorrel.goal_link = on, transaction-local). Migration 70.';

revoke all on function public.guard_goal_link() from public, anon, authenticated;

create trigger trg_goals_link_guard
  before insert or update on public.goals
  for each row execute function public.guard_goal_link();

-- ---------------------------------------------------------------------
-- 6. completed_at: manual goals as before; followed goals as written
--
-- 53's BEFORE UPDATE trigger re-derived completed_at from goal money on
-- every goals update. A followed goal's completion comes from its card,
-- so for it the trigger keeps what was there -- or, when the completion
-- gate is open, what the completion functions wrote. A goal that has
-- just started following a card begins not complete (it owes something,
-- or it couldn't have been linked).
-- ---------------------------------------------------------------------
create or replace function public.goals_sync_completed_at()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  if coalesce(current_setting('sorrel.goal_completion', true), '') = 'on' then
    return new;   -- written by the completion functions below
  end if;
  if new.tracking_method = 'LinkedAccount' then
    if old.tracking_method is distinct from 'LinkedAccount' or old.accountid is distinct from new.accountid then
      new.completed_at := null;
    else
      new.completed_at := old.completed_at;
    end if;
    return new;
  end if;
  new.completed_at := public.goal_completed_at(new.id, new.target_amount, old.completed_at);
  return new;
end;
$$;

comment on function public.goals_sync_completed_at() is
  'BEFORE UPDATE on goals: a manual goal''s completed_at is re-derived from its goal money (53, 69); a goal following a card keeps its completed_at, which only the card completion functions write (sorrel.goal_completion gate). Starting to follow a card clears it (migration 70).';

-- 53's contribution trigger and 69's transaction trigger re-derive
-- completion from goal money -- never for a goal following a card.
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
     and g.tracking_method <> 'LinkedAccount'
     and g.completed_at is distinct from public.goal_completed_at(g.id, g.target_amount, g.completed_at);

  if tg_op = 'UPDATE' and old.goalid is distinct from new.goalid then
    update public.goals g
       set completed_at = public.goal_completed_at(g.id, g.target_amount, g.completed_at)
     where g.id = old.goalid
       and g.tracking_method <> 'LinkedAccount'
       and g.completed_at is distinct from public.goal_completed_at(g.id, g.target_amount, g.completed_at);
  end if;

  return null;
end;
$$;

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
     and g.tracking_method <> 'LinkedAccount'
     and g.completed_at is distinct from public.goal_completed_at(g.id, g.target_amount, g.completed_at);

  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. A followed goal takes no new money of its own
-- ---------------------------------------------------------------------
create function public.refuse_money_to_followed_goal()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  if new.goalid is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.goalid is not distinct from old.goalid then
    return new;   -- its own history, edited in place
  end if;
  if exists (select 1 from public.goals g where g.id = new.goalid and g.tracking_method = 'LinkedAccount') then
    raise exception 'This goal follows its card''s balance, so payments count automatically.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.refuse_money_to_followed_goal() is
  'BEFORE INSERT OR UPDATE OF goalid on goal_contributions and transactions: a goal following a card takes no contributions and no linked transactions -- the card''s balance is its measure (migration 70). Rows it already had stay, as history.';

revoke all on function public.refuse_money_to_followed_goal() from public, anon, authenticated;

create trigger trg_goal_contributions_refuse_followed
  before insert or update of goalid on public.goal_contributions
  for each row execute function public.refuse_money_to_followed_goal();

create trigger trg_transactions_refuse_followed_goal
  before insert or update of goalid on public.transactions
  for each row execute function public.refuse_money_to_followed_goal();

-- ---------------------------------------------------------------------
-- 8. Card completion
-- ---------------------------------------------------------------------

-- Sets or re-assesses one followed goal's completion. p_touched are the
-- dates of the transaction rows this write changed; p_reassess says
-- whether this write may re-assess a completed goal at all (an edit or a
-- delete may; an insert, and a balance reset, may not -- by ruling).
create function public.sync_card_goal_completion(p_goal_id uuid, p_touched date[], p_reassess boolean)
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
  select g.id, g.userid, g.accountid, g.completed_at
    into v_goal
    from public.goals g
   where g.id = p_goal_id and g.tracking_method = 'LinkedAccount';
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
  'A goal following a card: completes when a write leaves the card owing nothing as of the user''s today. Sticky: re-assessed only when p_reassess (an edit or delete) touched a transaction dated on or before the completion day -- kept if the card owed nothing as of that day, else cleared (and completed again today if it owes nothing now). Migration 70.';

-- The trigger functions call it as the user, so the user needs EXECUTE.
-- Called directly it only ever re-derives the truth for the caller's own
-- goals (RLS scopes the read and the write).
revoke all on function public.sync_card_goal_completion(uuid, date[], boolean) from public, anon;
grant execute on function public.sync_card_goal_completion(uuid, date[], boolean) to authenticated;

create function public.transactions_sync_card_goals()
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
    perform public.sync_card_goal_completion(v_goal_id, v_touched, tg_op <> 'INSERT');
  end loop;
  return null;
end;
$$;

comment on function public.transactions_sync_card_goals() is
  'AFTER INSERT/UPDATE/DELETE on transactions: a write on a card a goal follows syncs that goal''s completion (sync_card_goal_completion). Inserts can complete; edits and deletes can also re-assess (migration 70).';

revoke all on function public.transactions_sync_card_goals() from public, anon, authenticated;

create trigger trg_transactions_card_goals
  after insert or delete
     or update of amount, transaction_type, transaction_date, accountid, counts_despite_anchor, anchor_answer_set_at
  on public.transactions
  for each row execute function public.transactions_sync_card_goals();

-- ---------------------------------------------------------------------
-- 9. Link and unlink
-- ---------------------------------------------------------------------

-- Starts following a card. The goal's own contributions and linked
-- transactions stay as history and stop counting; the app says so before
-- calling this. security invoker: RLS scopes every row read and written.
create function public.link_goal_to_card(p_goal_id uuid, p_account_id uuid)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_goal    record;
  v_account record;
  v_owed    numeric;
begin
  select g.id, g.goal_type, g.tracking_method, g.is_active
    into v_goal
    from public.goals g
   where g.id = p_goal_id;
  if not found then
    raise exception 'Goal not found.' using errcode = 'P0002';
  end if;
  if v_goal.goal_type <> 'Debt Payoff' then
    raise exception 'Only a debt payoff goal can follow a card.' using errcode = '23514';
  end if;
  if v_goal.tracking_method = 'LinkedAccount' then
    raise exception 'This goal already follows a card. Stop following it first.' using errcode = '23514';
  end if;

  select b.account_id, b.account_type, b.is_active, b.balance
    into v_account
    from public.v_account_balances b
   where b.account_id = p_account_id;
  if not found or not v_account.is_active then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;
  if not public.is_liability_account_type(v_account.account_type) then
    raise exception 'A goal can follow a credit card or loan.' using errcode = '23514';
  end if;

  v_owed := -v_account.balance;
  if v_owed <= 0 then
    raise exception 'This card doesn''t owe anything right now.' using errcode = '23514';
  end if;

  perform set_config('sorrel.goal_link', 'on', true);
  update public.goals
     set tracking_method = 'LinkedAccount',
         accountid = p_account_id,
         starting_balance = v_owed,
         linked_at = now()
   where id = p_goal_id;
  perform set_config('sorrel.goal_link', '', true);
end;
$$;

comment on function public.link_goal_to_card(uuid, uuid) is
  'A debt payoff goal starts following a credit card or loan (is_liability_account_type) that owes something: starting_balance = what it owes now, recorded once. Existing contributions and linked transactions stay as history, uncounted (migration 70).';

revoke all on function public.link_goal_to_card(uuid, uuid) from public, anon;
grant execute on function public.link_goal_to_card(uuid, uuid) to authenticated;

-- Stops following, keeping the number: the progress made while following
-- becomes one 'carried_over' contribution, and the target is set so the
-- amount to go is unchanged. A paid-off goal stays paid off. Returns the
-- amount carried over.
create function public.unlink_goal_from_card(p_goal_id uuid)
returns numeric
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_goal    record;
  v_owed    numeric;
  v_history numeric;
  v_carried numeric;
  v_target  numeric;
begin
  select g.id, g.userid, g.accountid, g.starting_balance, g.completed_at
    into v_goal
    from public.goals g
   where g.id = p_goal_id and g.tracking_method = 'LinkedAccount';
  if not found then
    raise exception 'This goal doesn''t follow a card.' using errcode = 'P0002';
  end if;

  v_owed := -coalesce((select b.balance from public.v_account_balances b where b.account_id = v_goal.accountid), 0);
  v_history := coalesce((select sum(m.amount) from public.v_goal_money m where m.goalid = v_goal.id), 0);

  if v_goal.completed_at is not null then
    v_carried := v_goal.starting_balance;
    v_target := v_history + v_carried;
  else
    v_carried := greatest(v_goal.starting_balance - v_owed, 0);
    v_target := v_history + v_carried + greatest(v_owed, 0);
  end if;

  perform set_config('sorrel.goal_link', 'on', true);
  perform set_config('sorrel.goal_completion', 'on', true);
  update public.goals
     set tracking_method = 'Manual',
         accountid = null,
         starting_balance = null,
         linked_at = null,
         target_amount = v_target
   where id = v_goal.id;
  perform set_config('sorrel.goal_completion', '', true);
  perform set_config('sorrel.goal_link', '', true);

  if v_carried > 0 then
    insert into public.goal_contributions (goalid, userid, amount, date, funding_method)
    values (v_goal.id, v_goal.userid, v_carried, public.user_day(v_goal.userid, now()), 'carried_over');
  end if;

  return v_carried;
end;
$$;

comment on function public.unlink_goal_from_card(uuid) is
  'A goal stops following its card and keeps its number: the progress made while following becomes one carried_over contribution (the starting balance, for a paid-off goal) and target_amount is set so the amount to go is unchanged. Called on an explicit unlink, a type change (lib/db/goals.ts), and when the card is archived or stops being a liability (migration 70).';

revoke all on function public.unlink_goal_from_card(uuid) from public, anon;
grant execute on function public.unlink_goal_from_card(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 10. The card changes: a new balance can complete; archiving, or no
--     longer being a liability, unlinks
-- ---------------------------------------------------------------------
create function public.accounts_sync_card_goals()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_goal_id uuid;
begin
  for v_goal_id in
    select g.id from public.goals g
     where g.tracking_method = 'LinkedAccount' and g.accountid = new.id
  loop
    if (old.is_active and not new.is_active)
       or not public.is_liability_account_type(new.account_type) then
      perform public.unlink_goal_from_card(v_goal_id);
    else
      -- A new balance is not an edit of the card's history: it can
      -- complete the goal, never reopen it.
      perform public.sync_card_goal_completion(v_goal_id, array[]::date[], false);
    end if;
  end loop;
  return null;
end;
$$;

comment on function public.accounts_sync_card_goals() is
  'AFTER UPDATE on accounts: for goals following this account, archiving it or changing it to a non-liability type unlinks them (unlink_goal_from_card); a new opening balance can complete them, never reopen them (migration 70).';

revoke all on function public.accounts_sync_card_goals() from public, anon, authenticated;

create trigger trg_accounts_card_goals
  after update of is_active, account_type, opening_balance, opening_date, opening_set_at on public.accounts
  for each row execute function public.accounts_sync_card_goals();

-- ---------------------------------------------------------------------
-- 11. v_goal_progress: manual or following a card
--
-- 69's definition, with each figure read through one lateral `p`:
-- manual goals exactly as before; a followed goal from its card. A
-- completed followed goal rests at 100% ("Paid off on <date>"): a later
-- charge doesn't reopen it, so it doesn't move its meter either.
-- New columns on the end: starting_balance, owed_amount (the card's
-- true figure, positive = owed), linked_account_name, linked_at.
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
    g.linked_at
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
            END AS owed ) o
     CROSS JOIN LATERAL ( SELECT
            o.owed,
            CASE
              WHEN g.tracking_method <> 'LinkedAccount' THEN COALESCE(c.contributed, (0)::numeric)
              WHEN g.completed_at IS NOT NULL THEN g.starting_balance
              ELSE GREATEST(LEAST(g.starting_balance - o.owed, g.starting_balance), (0)::numeric)
            END AS contributed,
            CASE
              WHEN g.tracking_method <> 'LinkedAccount'
                THEN GREATEST((g.target_amount - COALESCE(c.contributed, (0)::numeric)), (0)::numeric)
              WHEN g.completed_at IS NOT NULL THEN (0)::numeric
              ELSE GREATEST(o.owed, (0)::numeric)
            END AS remaining,
            CASE
              WHEN g.tracking_method <> 'LinkedAccount'
                THEN LEAST((COALESCE(c.contributed, (0)::numeric) / NULLIF(g.target_amount, (0)::numeric)), (1)::numeric)
              WHEN g.completed_at IS NOT NULL THEN (1)::numeric
              ELSE GREATEST(LEAST(((g.starting_balance - o.owed) / g.starting_balance), (1)::numeric), (0)::numeric)
            END AS ratio ) p;

comment on view public.v_goal_progress is
  'Per goal: progress from its goal money (v_goal_money, 69) -- or, for a debt payoff goal following a card (migration 70), from the card: owed_amount is what it owes now, remaining_amount the amount to go, pct_complete (starting_balance - owed) / starting_balance clamped 0..100. A completed followed goal rests at 100%.';

revoke all on table public.v_goal_progress from public, anon, authenticated, service_role;
grant select, references, trigger, truncate, maintain on table public.v_goal_progress to authenticated;
grant references, trigger, truncate, maintain on table public.v_goal_progress to service_role;

-- ---------------------------------------------------------------------
-- 12. v_goal_monthly_holds: a followed goal holds nothing
--
-- 69's definition with one more condition.
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
      where u.recurring_id = g.funding_recurringid
        and public.leaves_spendable_set(u.account_type, u.to_account_type)
   );

comment on view public.v_goal_monthly_holds is
  'Per goal, this month''s money safe to spend sets aside: max(0, monthly_contribution - goal money dated this month), capped at what''s left to the target, for active, uncompleted, manual goals with a monthly target and no counted funding transfer (goals.funding_recurringid). A goal following a card holds nothing: payments to the card are already counted in the projection (migration 70). Derived, never stored.';

revoke all on table public.v_goal_monthly_holds from public, anon, authenticated, service_role;
grant select, references, trigger, truncate, maintain on table public.v_goal_monthly_holds to authenticated;
grant references, trigger, truncate, maintain on table public.v_goal_monthly_holds to service_role;
