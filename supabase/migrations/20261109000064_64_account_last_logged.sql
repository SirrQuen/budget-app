-- =====================================================================
-- Sorrel 64: when each account was last logged to
-- (docs/Budgets-Reminders-and-Pending.md, item 5)
--
-- "Last logged 12 days ago" on the dashboard, one line per account. The
-- question is "when did I last touch this account", not "what's the
-- latest date I've recorded" -- someone entering a week of backdated
-- transactions today was active today -- so it reads created_at, never
-- transaction_date (v_account_balances.last_transaction_date answers the
-- other question).
--
-- last_logged_on is created_at as a calendar day in the user's zone:
-- inside an API request the apply_user_timezone() pre-request hook
-- (migration 40) has set the session TimeZone, so ::date is the user's
-- day, the same day getToday() returns. A transfer's two legs are each
-- their own account's activity.
--
-- A fact, not a nudge: the app shows it in neutral ink with no threshold.
-- =====================================================================

create function public.account_last_logged()
returns table (account_id uuid, last_logged_on date)
language sql
stable
security invoker
set search_path = public
as $$
  select t.accountid, max(t.created_at)::date
    from transactions t
   group by t.accountid;
$$;

comment on function public.account_last_logged() is
  'Per account, the user''s calendar day of the most recently CREATED transaction (created_at, not transaction_date) -- "Last logged 12 days ago". Accounts with none are absent. security invoker: RLS scopes it to the caller (migration 64).';

revoke all on function public.account_last_logged() from public, anon;
grant execute on function public.account_last_logged() to authenticated;
