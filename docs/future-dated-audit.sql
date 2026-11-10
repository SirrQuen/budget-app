-- How many transactions are dated after their owner's today -- the rows
-- whose effect leaves balances when migration 65 (counts_in_balance)
-- deploys. Counts only; no amounts, no ids, no names.
--
-- "Today" is each user's calendar day in settings.timezone (null or a
-- name Postgres doesn't know means UTC), named explicitly because this
-- runs outside the apply_user_timezone() hook.
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf --read-only -f docs/future-dated-audit.sql   # sorrel-dev
--   npx supabase db query --remote=ybdwqyihvbokowocvlgq --read-only -f docs/future-dated-audit.sql   # production

with user_today as (
  select s.userid,
         (now() at time zone coalesce(
            (select z.name from pg_timezone_names z where z.name = s.timezone),
            'UTC'))::date as today
    from public.settings s
),
future as (
  select t.userid, t.transfer_group_id, a.account_type, t.transaction_date, u.today
    from public.transactions t
    join public.accounts a on a.id = t.accountid
    join user_today u on u.userid = t.userid
   where t.transaction_date > u.today
)
select count(*)                                                    as future_rows,
       count(distinct userid)                                      as users_affected,
       count(*) filter (where transfer_group_id is not null)       as transfer_legs,
       count(*) filter (where account_type in ('Checking', 'Cash')) as on_spendable_accounts,
       max(transaction_date - today)                               as furthest_days_ahead
  from future;
