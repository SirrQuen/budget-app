-- =====================================================================
-- Sorrel 65: a transaction dated after today doesn't count toward a
-- balance until its date
--
-- Until now the balance rule bounded transactions from below only (the
-- anchor, migrations 48 and 62). Rent entered on the 2nd and dated the
-- 28th moved the checking balance on the 2nd, though the money hadn't
-- moved. The mirror of the anchor rule closes it: a transaction counts
-- toward a balance when the anchor rule includes it AND it is dated no
-- later than today -- the USER'S today.
--
-- TWO FUNCTIONS, COMPOSED:
--
--   anchor_includes()    unchanged. Still the anchor question alone, and
--                        still what trg_transactions_anchor_answer and
--                        balance_anchor_preview() ask: a future date is
--                        after the anchor, so it is never asked about.
--   counts_in_balance()  anchor_includes() AND not after p_as_of. Every
--                        balance reads this one.
--
-- p_as_of is REQUIRED -- no default, and a null raises rather than
-- quietly answering the anchor question alone (a wrong balance with no
-- error). Two names make calling the wrong one visible in the code.
-- It stays IMMUTABLE because the caller supplies the date.
--
-- The callers pass current_date. Inside an API request that is the
-- user's calendar day in settings.timezone -- apply_user_timezone()
-- (migration 40) sets the session TimeZone per request -- the same day
-- getToday() and useToday() name. Migrations and the service role run
-- outside the hook, in UTC; nothing here depends on them.
--
-- The money isn't lost while it waits: a future-dated transaction in
-- Checking or Cash is an expectation in the safe-to-spend projection
-- (v_future_transactions below, lib/safeToSpendProjection.ts) from the
-- moment it's entered, and leaves it for the balance on its date. No
-- confirmation: the person created the record; it simply starts counting.
--
-- Budget progress, cash flow, category spending and the streak sum
-- transactions by date and don't read the balance rule; they still count
-- a future-dated transaction from entry. Deferred deliberately -- see
-- docs/phase-7-findings.md, "Budget progress counts future-dated
-- transactions".
--
-- BALANCES MOVE ON DEPLOY: every future-dated transaction stops counting
-- until its date. Production carried 12 such rows (one user) on
-- 2026-11-10 (docs/future-dated-audit.sql).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. THE balance rule: the anchor rule, bounded by today
-- ---------------------------------------------------------------------
create function public.counts_in_balance(
  p_transaction_date      date,
  p_recorded_at           timestamptz,
  p_anchor_date           date,
  p_anchor_set_at         timestamptz,
  p_counts_despite_anchor boolean,
  p_answer_set_at         timestamptz,
  p_as_of                 date
)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
begin
  if p_as_of is null then
    raise exception 'counts_in_balance() needs p_as_of: the user''s today (current_date inside a request).'
      using errcode = '22004';
  end if;
  return coalesce(
    public.anchor_includes(p_transaction_date, p_recorded_at, p_anchor_date, p_anchor_set_at,
                           p_counts_despite_anchor, p_answer_set_at)
    and p_transaction_date <= p_as_of,
    false);
end;
$$;

comment on function public.counts_in_balance(date, timestamptz, date, timestamptz, boolean, timestamptz, date) is
  'THE balance rule: anchor_includes() (the anchor question, unchanged) AND dated no later than p_as_of, the user''s today -- pass current_date inside a request (migration 40 makes it the user''s day). p_as_of is required; null raises. v_account_balances, counts_toward_balance and v_future_transactions call it; the anchor trigger and balance_anchor_preview call anchor_includes() alone. Never restate either comparison (migration 65).';

revoke all on function public.counts_in_balance(date, timestamptz, date, timestamptz, boolean, timestamptz, date) from public, anon;
grant execute on function public.counts_in_balance(date, timestamptz, date, timestamptz, boolean, timestamptz, date) to authenticated;

comment on function public.anchor_includes(date, timestamptz, date, timestamptz, boolean, timestamptz) is
  'The balance ANCHOR rule: does a transaction dated p_transaction_date, recorded at p_recorded_at, fall inside a balance anchored at p_anchor_date, set at p_anchor_set_at? After the date always; before never; on it only if recorded after the anchor was set -- unless the person answered "No, add it to my balance" (p_counts_despite_anchor) against THIS anchor (p_answer_set_at = p_anchor_set_at). Pass null, null for the date rule alone. The anchor question only: a balance reads counts_in_balance(), which adds "not after today" (migration 65). trg_transactions_anchor_answer and balance_anchor_preview call this directly. Never restate the comparison (migrations 48, 62).';


-- ---------------------------------------------------------------------
-- 2. v_account_balances: same columns, today bounds the sum
-- ---------------------------------------------------------------------
create or replace view public.v_account_balances
with (security_invoker = true) as
select
  a.id as account_id, a.userid, a.account_name, a.account_type, a.institution,
  a.color, a.account_icon, a.is_active, a.opening_balance,
  a.opening_balance + coalesce(t.delta, 0)  as balance,
  coalesce(t.transaction_count, 0)          as transaction_count,
  t.first_transaction_date, t.last_transaction_date
from public.accounts a
left join lateral (
  select sum(public.signed_amount(tr.amount, tr.transaction_type)) as delta,
         count(*)                 as transaction_count,
         min(tr.transaction_date) as first_transaction_date,
         max(tr.transaction_date) as last_transaction_date
  from public.transactions tr
  where tr.accountid = a.id
    and public.counts_in_balance(tr.transaction_date, tr.created_at,
                                 a.opening_date, a.opening_set_at,
                                 tr.counts_despite_anchor, tr.anchor_answer_set_at,
                                 current_date)
) t on true;


-- ---------------------------------------------------------------------
-- 3. counts_toward_balance(transactions): the stored row, today included
-- ---------------------------------------------------------------------
create or replace function public.counts_toward_balance(t public.transactions)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select counts_in_balance(t.transaction_date, t.created_at, a.opening_date, a.opening_set_at,
                           t.counts_despite_anchor, t.anchor_answer_set_at, current_date)
    from accounts a
   where a.id = t.accountid;
$$;


-- ---------------------------------------------------------------------
-- 4. v_future_transactions: what will count on its date
--
-- One row per occurrence -- a transaction, or a transfer (its Expense
-- leg, the source, with the Income leg's account beside it). A leg
-- "counts later" when the anchor rule includes it, it isn't counted yet
-- (counts_in_balance(..., current_date) is false), and its account is
-- active (spendable_cash_balance() reads active accounts only). Both
-- flags are carried for a transfer: the projection reads the leg on the
-- side the classifier says it acts as (lib/safeToSpend.ts). Nothing here
-- decides spendability -- that's the classifier's.
-- ---------------------------------------------------------------------
create view public.v_future_transactions
with (security_invoker = true) as
select * from (
select
  t.id                 as transaction_id,
  t.userid,
  t.transfer_group_id,
  case when t.transfer_group_id is null then t.transaction_type else 'Transfer' end as kind,
  t.transaction_date,
  t.amount,
  t.description,
  t.accountid,
  a.account_name,
  a.account_type,
  c.icon               as category_icon,
  a.is_active
    and public.anchor_includes(t.transaction_date, t.created_at, a.opening_date, a.opening_set_at,
                               t.counts_despite_anchor, t.anchor_answer_set_at)
    and not public.counts_in_balance(t.transaction_date, t.created_at, a.opening_date, a.opening_set_at,
                                     t.counts_despite_anchor, t.anchor_answer_set_at, current_date)
                       as counts_later,
  d.accountid          as to_accountid,
  da.account_name      as to_account_name,
  da.account_type      as to_account_type,
  coalesce(
    da.is_active
      and public.anchor_includes(d.transaction_date, d.created_at, da.opening_date, da.opening_set_at,
                                 d.counts_despite_anchor, d.anchor_answer_set_at)
      and not public.counts_in_balance(d.transaction_date, d.created_at, da.opening_date, da.opening_set_at,
                                       d.counts_despite_anchor, d.anchor_answer_set_at, current_date),
    false)             as to_counts_later
from public.transactions t
join public.accounts a on a.id = t.accountid
left join public.categories c on c.id = t.categoryid
left join public.transactions d
       on t.transfer_group_id is not null
      and d.transfer_group_id = t.transfer_group_id
      and d.transaction_type = 'Income'
left join public.accounts da on da.id = d.accountid
where t.transfer_group_id is null or t.transaction_type = 'Expense'
) x
where x.counts_later or x.to_counts_later;

comment on view public.v_future_transactions is
  'Transactions (a transfer once, as its source leg) that the balance rule will count on their date but doesn''t yet -- dated after the user''s today. counts_later / to_counts_later per leg; the projection classifies with lib/safeToSpend.ts and counts each on its date. No confirmation: on its date it simply joins the balance (migration 65).';

-- Every other view's ACL, set as migration 57 sets it. A new object
-- picks up the project's default privileges, and those differ: sorrel-dev
-- has Supabase's stock defaults (every privilege for authenticated and
-- service_role), production's were reduced. Revoking from all four roles
-- means neither project's defaults decide (CLAUDE.md, "Any migration that
-- creates a view").
revoke all on table public.v_future_transactions from public, anon, authenticated, service_role;
grant select, references, trigger, truncate, maintain on table public.v_future_transactions to authenticated;
grant references, trigger, truncate, maintain on table public.v_future_transactions to service_role;
