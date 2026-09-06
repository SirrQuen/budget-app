-- =====================================================================
-- Account opening_date: fixes a correctness bug in the balance model.
--
-- opening_balance answers "how much did this account hold" but never said
-- *as of when* -- every transaction dated before an account was created
-- was silently folded into the running balance even though the balance
-- the user typed was only ever true as of the day they entered it.
-- opening_date is that missing anchor: only transactions on or after it
-- feed the balance.
--
-- Backfill: existing accounts get created_at's date, which is exactly
-- when their opening_balance was actually entered.
-- =====================================================================

alter table accounts
  add column if not exists opening_date date not null default current_date;

update accounts
   set opening_date = created_at::date;


-- =====================================================================
-- v_account_balances: the lateral sum now excludes transactions dated
-- before the account's opening_date. Nothing else about the view changes.
-- =====================================================================

create or replace view public.v_account_balances
with (security_invoker = true) as
select
  a.id as account_id, a.userid, a.account_name, a.account_type, a.institution,
  a.color, a.account_icon, a.is_active, a.opening_balance,
  a.opening_balance + coalesce(t.delta, 0)  as balance,
  coalesce(t.transaction_count, 0)          as transaction_count,
  t.first_transaction_date, t.last_transaction_date
from accounts a
left join lateral (
  select sum(public.signed_amount(tr.amount, tr.transaction_type)) as delta,
         count(*)                 as transaction_count,
         min(tr.transaction_date) as first_transaction_date,
         max(tr.transaction_date) as last_transaction_date
  from transactions tr
  where tr.accountid = a.id
    and tr.transaction_date >= a.opening_date
) t on true;


-- v_net_worth needs no change -- it reads v_account_balances.balance,
-- which already reflects the filtered sum above.
