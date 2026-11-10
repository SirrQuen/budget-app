-- Future-dated transactions per user -- whose balances move when
-- migration 65 deploys. Counts only: no amounts, no descriptions.
-- Identifies each user by first name and the first 8 characters of
-- their id, enough to tell a tester from the owner.
--
--   npx supabase db query --remote=ybdwqyihvbokowocvlgq --read-only -f docs/future-dated-audit-by-user.sql   # production

with user_today as (
  select s.userid,
         (now() at time zone coalesce(
            (select z.name from pg_timezone_names z where z.name = s.timezone),
            'UTC'))::date as today
    from public.settings s
)
select left(t.userid::text, 8)                                         as user_id_prefix,
       p.first_name,
       count(*)                                                        as future_rows,
       count(distinct coalesce(t.transfer_group_id, t.id))             as future_items,
       count(*) filter (where a.account_type in ('Checking', 'Cash'))  as on_spendable_accounts,
       min(t.transaction_date)                                         as earliest,
       max(t.transaction_date)                                         as latest
  from public.transactions t
  join public.accounts a   on a.id = t.accountid
  join user_today u        on u.userid = t.userid
  left join public.profiles p on p.id = t.userid
 where t.transaction_date > u.today
 group by t.userid, p.first_name
 order by future_rows desc;
