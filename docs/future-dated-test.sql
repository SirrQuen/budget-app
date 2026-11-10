-- =====================================================================
-- Future-dated transactions test (migration 65)
--
-- Run against sorrel-dev after any change to counts_in_balance(),
-- anchor_includes(), v_account_balances, v_future_transactions or their
-- readers:
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/future-dated-test.sql
--
-- One row per assertion (section, check, expected, actual, pass). A run
-- is clean only when every `pass` is true.
--
-- Self-cleaning, like docs/balance-anchor-test.sql: ONE transaction
-- ending in ROLLBACK, one throwaway user, nothing committed. Cleanup
-- check after a run (must be 0):
--   select count(*) from auth.users where email like 'future-test-%@example.invalid';
--
-- "Today" is the user's day. Section 3 moves it the way production does
-- -- settings.timezone, then apply_user_timezone(), the PostgREST
-- pre-request hook (migration 40) -- between two zones 25 hours apart,
-- so the same row, with no write to it, is "tomorrow" in one and "today"
-- in the other at ANY wall-clock time. That is the 11:55pm case without
-- waiting for 11:55pm: the boundary is the session's day, never UTC's.
--
-- Sections
--   1  The rule       counts_in_balance() truth table; null p_as_of raises;
--                     anchor_includes() unchanged
--   2  Balances       a row dated tomorrow doesn't move the balance or
--                     Spendable Cash today; it isn't asked the anchor
--                     question; v_future_transactions carries it
--   3  The boundary   the same row counts once the user's day reaches it
--   4  Not spendable  a future charge on Savings or a card: the view
--                     carries it (the projection's classifier drops it),
--                     Spendable Cash never moves
--   5  Transfers      one row per transfer, both legs flagged
-- =====================================================================

begin;

create temp table future_results (
  seq      serial primary key,
  section  text not null,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
grant insert on future_results to authenticated;
grant usage on sequence future_results_seq_seq to authenticated;

create function pg_temp.rec(p_section text, p_check text, p_expected text, p_actual text)
returns void language sql as $$
  insert into future_results (section, check_, expected, actual, pass)
  values (p_section, p_check, p_expected, coalesce(p_actual, 'null'),
          coalesce(p_expected = p_actual, false))
$$;

create function pg_temp.become(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end
$$;

create function pg_temp.unbecome() returns void language plpgsql as $$
begin
  execute 'set local role none';
  perform set_config('request.jwt.claims', '', true);
end
$$;

create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end
$$;

-- The user's zone, applied as a request would apply it.
create function pg_temp.set_zone(p_zone text) returns void language plpgsql as $$
begin
  update public.settings set timezone = p_zone
   where userid = 'f07f07f0-f07f-4f07-8f07-f07f07f07f07';
  perform public.apply_user_timezone();
end
$$;

create function pg_temp.balance(p_account uuid) returns text language sql as $$
  select balance::text from public.v_account_balances where account_id = p_account
$$;


-- ---------------------------------------------------------------------
-- 1. The rule
-- ---------------------------------------------------------------------
insert into future_results (section, check_, expected, actual, pass)
select '1 rule', v.what, v.expected::text, r::text, r = v.expected
  from (values
    ('after the anchor, before today',   date '2026-11-09', true),
    ('after the anchor, on today',       date '2026-11-10', true),
    ('after the anchor, after today',    date '2026-11-11', false),
    ('before the anchor, before today',  date '2026-10-01', false)
  ) as v(what, txn_date, expected)
 cross join lateral (
   select public.counts_in_balance(v.txn_date, timestamptz '2026-11-01 12:00Z',
                                   date '2026-10-10', timestamptz '2026-10-10 17:00Z',
                                   null, null, date '2026-11-10') as r
 ) x;

select pg_temp.rec('1 rule', 'answered "No, add it", but dated after today: not yet', 'false',
  public.counts_in_balance(date '2026-11-11', timestamptz '2026-11-01 12:00Z',
                           date '2026-11-20', timestamptz '2026-11-20 17:00Z',
                           true, timestamptz '2026-11-20 17:00Z', date '2026-11-10')::text);

select pg_temp.rec('1 rule', 'p_as_of null raises -- never the anchor answer alone', '22004',
  pg_temp.sqlstate_of($q$select public.counts_in_balance(date '2026-11-11', now(), date '2026-10-10',
                                                          now(), null, null, null)$q$));

select pg_temp.rec('1 rule', 'anchor_includes() unchanged: a future date is after the anchor', 'true',
  public.anchor_includes(date '2099-01-01', now(), date '2026-10-10', now(), null, null)::text);


-- ---------------------------------------------------------------------
-- Fixture: one user; Checking $1000, Savings $500, a card owing $0,
-- all anchored 30 days back. Zone UTC to start.
-- ---------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('f07f07f0-f07f-4f07-8f07-f07f07f07f07', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'future-test-a@example.invalid', '{}'::jsonb,
        '{"first_name": "Future"}'::jsonb, now(), now());

select pg_temp.become('f07f07f0-f07f-4f07-8f07-f07f07f07f07');
select pg_temp.set_zone('UTC');

insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
values ('f07f07f0-0000-4000-8000-000000000001', 'f07f07f0-f07f-4f07-8f07-f07f07f07f07',
        'Future checking', 'Checking', 1000, current_date - 30),
       ('f07f07f0-0000-4000-8000-000000000002', 'f07f07f0-f07f-4f07-8f07-f07f07f07f07',
        'Future savings', 'Savings', 500, current_date - 30),
       ('f07f07f0-0000-4000-8000-000000000003', 'f07f07f0-f07f-4f07-8f07-f07f07f07f07',
        'Future card', 'Credit Card', 0, current_date - 30);


-- ---------------------------------------------------------------------
-- 2. Balances: rent dated tomorrow, entered today, with no answer given
-- ---------------------------------------------------------------------
select pg_temp.rec('2 balances', 'insert dated tomorrow, no anchor answer: accepted', 'null',
  pg_temp.sqlstate_of($q$
    insert into public.transactions (id, userid, accountid, categoryid, description,
                                     amount, transaction_type, transaction_date)
    select 'f07f07f0-0000-4000-8000-0000000000a1', 'f07f07f0-f07f-4f07-8f07-f07f07f07f07',
           'f07f07f0-0000-4000-8000-000000000001', c.id, 'Rent',
           100, 'Expense', current_date + 1
      from public.categories c
     where c.category_name = 'Groceries'$q$));

select pg_temp.rec('2 balances', 'it carries no anchor answer', 'null',
  (select coalesce(counts_despite_anchor::text, 'null') from public.transactions
    where id = 'f07f07f0-0000-4000-8000-0000000000a1'));

select pg_temp.rec('2 balances', 'checking balance today: unmoved', '1000.00',
  pg_temp.balance('f07f07f0-0000-4000-8000-000000000001'));

select pg_temp.rec('2 balances', 'Spendable Cash today: unmoved', '1000.00',
  (select public.spendable_cash_balance()::text));

select pg_temp.rec('2 balances', 'counts_toward_balance(): false', 'false',
  (select public.counts_toward_balance(t)::text from public.transactions t
    where t.id = 'f07f07f0-0000-4000-8000-0000000000a1'));

select pg_temp.rec('2 balances', 'v_future_transactions carries it, counting later', 'Expense Checking true',
  (select kind || ' ' || account_type || ' ' || counts_later::text from public.v_future_transactions
    where transaction_id = 'f07f07f0-0000-4000-8000-0000000000a1'));

select pg_temp.rec('2 balances', 'net worth: unmoved', '1500.00',
  (select net_worth::text from public.v_net_worth));

-- UTC's tomorrow can be Kiritimati's today; out of section 3's way.
delete from public.transactions where id = 'f07f07f0-0000-4000-8000-0000000000a1';


-- ---------------------------------------------------------------------
-- 3. The boundary is the user's day
--
-- r2 is dated "today" in Kiritimati (UTC+14). In Pago Pago (UTC-11) it
-- is one or two days ahead, whatever the wall clock says. Only the zone
-- changes between the two reads -- nothing writes to the row.
-- ---------------------------------------------------------------------
select pg_temp.set_zone('Pacific/Kiritimati');
insert into public.transactions (id, userid, accountid, categoryid, description,
                                 amount, transaction_type, transaction_date)
select 'f07f07f0-0000-4000-8000-0000000000a2', 'f07f07f0-f07f-4f07-8f07-f07f07f07f07',
       'f07f07f0-0000-4000-8000-000000000001', c.id, 'Dinner',
       40, 'Expense', current_date
  from public.categories c
 where c.category_name = 'Groceries';

select pg_temp.set_zone('Pacific/Pago_Pago');
select pg_temp.rec('3 boundary', 'Pago Pago: the zone is applied', 'Pacific/Pago_Pago',
  current_setting('timezone'));
select pg_temp.rec('3 boundary', 'Pago Pago: still its evening before -- not counted', '1000.00',
  pg_temp.balance('f07f07f0-0000-4000-8000-000000000001'));
select pg_temp.rec('3 boundary', 'Pago Pago: in v_future_transactions', '1',
  (select count(*)::text from public.v_future_transactions
    where transaction_id = 'f07f07f0-0000-4000-8000-0000000000a2'));

select pg_temp.set_zone('Pacific/Kiritimati');
select pg_temp.rec('3 boundary', 'Kiritimati: its date has come -- counted, no action taken', '960.00',
  pg_temp.balance('f07f07f0-0000-4000-8000-000000000001'));
select pg_temp.rec('3 boundary', 'Kiritimati: gone from v_future_transactions', '0',
  (select count(*)::text from public.v_future_transactions
    where transaction_id = 'f07f07f0-0000-4000-8000-0000000000a2'));


-- ---------------------------------------------------------------------
-- 4. Not spendable: Savings and a card, dated ahead
--
-- Sections 4 and 5 stay in Kiritimati, where Dinner has counted.
-- ---------------------------------------------------------------------
insert into public.transactions (id, userid, accountid, categoryid, description,
                                 amount, transaction_type, transaction_date)
select v.id, 'f07f07f0-f07f-4f07-8f07-f07f07f07f07', v.acct, c.id, v.what,
       v.amount, 'Expense', current_date + 3
  from (values
    ('f07f07f0-0000-4000-8000-0000000000b1'::uuid, 'f07f07f0-0000-4000-8000-000000000002'::uuid, 'From savings', 70),
    ('f07f07f0-0000-4000-8000-0000000000b2'::uuid, 'f07f07f0-0000-4000-8000-000000000003'::uuid, 'On the card',  30)
  ) as v(id, acct, what, amount)
  cross join lateral (select id from public.categories where category_name = 'Groceries') c;

select pg_temp.rec('4 not spendable', 'savings balance: unmoved', '500.00',
  pg_temp.balance('f07f07f0-0000-4000-8000-000000000002'));
select pg_temp.rec('4 not spendable', 'card balance: unmoved', '0.00',
  pg_temp.balance('f07f07f0-0000-4000-8000-000000000003'));
-- 1000 less Dinner.
select pg_temp.rec('4 not spendable', 'Spendable Cash: unmoved by either', '960.00',
  (select public.spendable_cash_balance()::text));
select pg_temp.rec('4 not spendable', 'the view carries both, by type, for the classifier', 'Credit Card,Savings',
  (select string_agg(account_type, ',' order by account_type) from public.v_future_transactions
    where transaction_id in ('f07f07f0-0000-4000-8000-0000000000b1', 'f07f07f0-0000-4000-8000-0000000000b2')));


-- ---------------------------------------------------------------------
-- 5. A transfer dated ahead: one row, both legs flagged
-- ---------------------------------------------------------------------
insert into public.transactions (userid, accountid, description, amount, transaction_type,
                                 transaction_date, transfer_group_id)
values ('f07f07f0-f07f-4f07-8f07-f07f07f07f07', 'f07f07f0-0000-4000-8000-000000000001',
        'To savings', 200, 'Expense', current_date + 2, 'f07f07f0-0000-4000-8000-0000000000c0'),
       ('f07f07f0-f07f-4f07-8f07-f07f07f07f07', 'f07f07f0-0000-4000-8000-000000000002',
        'To savings', 200, 'Income',  current_date + 2, 'f07f07f0-0000-4000-8000-0000000000c0');

select pg_temp.rec('5 transfers', 'one row: Transfer, Checking -> Savings, both legs later',
  '1 Transfer Checking Savings true true',
  (select count(*)::text || ' ' || max(kind) || ' ' || max(account_type) || ' ' || max(to_account_type)
          || ' ' || bool_and(counts_later)::text || ' ' || bool_and(to_counts_later)::text
     from public.v_future_transactions
    where transfer_group_id = 'f07f07f0-0000-4000-8000-0000000000c0'));
select pg_temp.rec('5 transfers', 'checking and savings balances: unmoved', '960.00 500.00',
  pg_temp.balance('f07f07f0-0000-4000-8000-000000000001') || ' '
    || pg_temp.balance('f07f07f0-0000-4000-8000-000000000002'));

select pg_temp.unbecome();


-- The report. Must be the last statement that returns rows.
select section, check_ as check, expected, actual, pass
  from future_results
 order by seq;

rollback;
