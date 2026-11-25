-- =====================================================================
-- Income and Spending tiles' scope test (docs/Income-Spending-Drilldown.md)
--
-- Run it through the runner, never directly:
--
--   npm run test:parity:flow
--
-- scripts/flow-scope-parity.ts pastes what the app's drill-down reads
-- (lib/transactionFilters.ts) into the __TS_FLOW_SCOPES__ marker below.
-- Run directly, the marker is not valid JSON and the file errors at once.
--
-- It writes, then rolls back, so it isn't --read-only and the CLI asks
-- for confirmation: Matt runs it. Self-cleaning: two throwaway users, one
-- transaction, ROLLBACK. Cleanup check (must be 0):
--   select count(*) from auth.users where email like 'flow-test-%@example.invalid';
--
-- A run passes only when its last row, SUMMARY, says ALL PASS.
--
-- For each user and flow, three figures must agree to the cent, and match
-- the figure worked out by hand:
--   tile        v_daily_cashflow's column over the scope's days (the view
--               the tile reads)
--   list        the transactions the drill-down's filters select
--   categories  those rows added up per category, then added together
--
-- Fixtures, October 2026: a transfer (two legs), a "Turn into a transfer"
-- pair (make_transfer), an import-joined transfer (import_transactions with
-- pair_with), a goal-linked expense, a refund, a row on an account archived
-- afterwards, a schedule not yet confirmed, an imported row, a row on the
-- 31st and one on 1 November.
-- =====================================================================

begin;

create temp table fs_results (
  seq      serial primary key,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
grant insert, select on fs_results to authenticated;
grant usage on sequence fs_results_seq_seq to authenticated;

create temp table fs_scopes as
select * from jsonb_to_recordset($ts$__TS_FLOW_SCOPES__$ts$::jsonb) as s(
  "user" text, zone text, instant timestamptz, flow text, "column" text,
  type text, date_from date, date_to date, exclude_transfers boolean);
grant select on fs_scopes to authenticated;

create function pg_temp.rec(p_check text, p_expected text, p_actual text) returns void
language sql as $$
  insert into fs_results (check_, expected, actual, pass)
  values (p_check, p_expected, coalesce(p_actual, '<null>'), coalesce(p_expected = p_actual, false))
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

create function pg_temp.cat(p_user uuid, p_name text) returns uuid language sql as $$
  select id from public.categories where userid = p_user and category_name = p_name
$$;

-- One flow for the signed-in user: the three figures and the row count.
create function pg_temp.compare(p_user text, p_flow text, p_total numeric, p_rows int) returns void
language plpgsql as $$
declare
  s       fs_scopes%rowtype;
  v_tile  numeric;
  v_list  numeric;
  v_cats  numeric;
  v_n     int;
begin
  select * into strict s from fs_scopes f where f."user" = p_user and f.flow = p_flow;

  select coalesce(sum(case s."column" when 'income' then d.income else d.expenses end), 0) into v_tile
    from public.v_daily_cashflow d
   where d.day between s.date_from and s.date_to;

  select coalesce(sum(t.amount), 0), count(*) into v_list, v_n
    from public.transactions t
   where t.transaction_type = s.type
     and t.transaction_date between s.date_from and s.date_to
     and (not s.exclude_transfers or t.transfer_group_id is null);

  select coalesce(sum(c.total), 0) into v_cats
    from (select sum(t.amount) as total
            from public.transactions t
           where t.transaction_type = s.type
             and t.transaction_date between s.date_from and s.date_to
             and (not s.exclude_transfers or t.transfer_group_id is null)
           group by t.categoryid) c;

  perform pg_temp.rec(p_user || ' ' || p_flow || ': tile', p_total::numeric(12,2)::text, v_tile::numeric(12,2)::text);
  perform pg_temp.rec(p_user || ' ' || p_flow || ': drill-down list', p_total::numeric(12,2)::text, v_list::numeric(12,2)::text);
  perform pg_temp.rec(p_user || ' ' || p_flow || ': category rows', p_total::numeric(12,2)::text, v_cats::numeric(12,2)::text);
  perform pg_temp.rec(p_user || ' ' || p_flow || ': row count', p_rows::text, v_n::text);
end
$$;

insert into auth.users (id, instance_id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'flow-test-ny@example.invalid', '{}'::jsonb,
        '{"first_name": "Flow", "last_name": "York"}'::jsonb, now(), now()),
       ('abababab-abab-4bab-8bab-abababababab', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'flow-test-akl@example.invalid', '{}'::jsonb,
        '{"first_name": "Flow", "last_name": "Auckland"}'::jsonb, now(), now());

update public.settings set timezone = 'America/New_York' where userid = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
update public.settings set timezone = 'Pacific/Auckland' where userid = 'abababab-abab-4bab-8bab-abababababab';

do $$
declare
  u     constant uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  a     constant uuid := 'abababab-abab-4bab-8bab-abababababab';
  chk   constant uuid := 'dddddddd-0000-4000-8000-000000000001';
  sav   constant uuid := 'dddddddd-0000-4000-8000-000000000002';
  old   constant uuid := 'dddddddd-0000-4000-8000-000000000003';
  achk  constant uuid := 'abababab-0000-4000-8000-000000000001';
  grp   uuid := gen_random_uuid();
  goal  uuid;
  src   uuid;
  inc   uuid;
  r     record;
begin
  -- The 23:30 rows are dated the user's day, never UTC's.
  for r in select distinct f."user" as who, f.zone, f.instant, f.date_to from fs_scopes f loop
    perform pg_temp.rec(r.who || ': 23:30 on 31 October is the last day of the scope', '2026-10-31 2026-10-31',
      (r.instant at time zone r.zone)::date || ' ' || r.date_to);
  end loop;

  perform pg_temp.become(u);
  -- Balance dates before the history, so no row is asked about (migration 62).
  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (chk, u, 'Flow checking', 'Checking', 5000, date '2026-01-01'),
         (sav, u, 'Flow savings',  'Savings',  1000, date '2026-01-01'),
         (old, u, 'Flow old',      'Checking',  500, date '2026-01-01');

  insert into public.goals (userid, goal_name, goal_type, target_amount)
  values (u, 'Flow goal', 'Custom', 10000) returning id into goal;

  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description, goalid)
  values (u, chk, pg_temp.cat(u, 'Paychecks/Salary'),         2500.00, 'Income',  date '2026-10-01', 'pay', null),
         (u, chk, pg_temp.cat(u, 'Paychecks/Salary'),         2500.10, 'Income',  date '2026-10-15', 'pay', null),
         (u, chk, pg_temp.cat(u, 'Refunds & Reimbursements'),   19.99, 'Income',  date '2026-10-18', 'refund', null),
         (u, chk, pg_temp.cat(u, 'Rent'),                     1850.00, 'Expense', date '2026-10-02', 'rent', null),
         (u, chk, pg_temp.cat(u, 'Restaurants'),                 0.10, 'Expense', date '2026-10-03', 'coffee', null),
         (u, chk, pg_temp.cat(u, 'Restaurants'),                 0.20, 'Expense', date '2026-10-03', 'coffee', null),
         (u, chk, pg_temp.cat(u, 'Travel'),                    120.00, 'Expense', date '2026-10-08', 'goal linked', goal),
         (u, old, pg_temp.cat(u, 'Groceries'),                  33.33, 'Expense', date '2026-10-09', 'archived account', null),
         (u, chk, pg_temp.cat(u, 'Groceries'),                  11.11, 'Expense', date '2026-10-31', '23:30 last day', null),
         (u, chk, pg_temp.cat(u, 'Groceries'),                   5.00, 'Expense', date '2026-11-01', 'next month', null),
         (u, chk, pg_temp.cat(u, 'Groceries'),                  88.00, 'Expense', date '2026-09-30', 'previous month', null);
  update public.accounts set is_active = false where id = old;

  -- A transfer.
  insert into public.transactions (userid, accountid, amount, transaction_type, transaction_date, description, transfer_group_id)
  values (u, chk, 200, 'Expense', date '2026-10-04', 'transfer', grp),
         (u, sav, 200, 'Income',  date '2026-10-04', 'transfer', grp);

  -- "Turn into a transfer".
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, chk, pg_temp.cat(u, 'Groceries'), 75, 'Expense', date '2026-10-05', 'turned into transfer')
  returning id into src;
  perform public.make_transfer(src, sav);

  -- An import-joined transfer, and a plain imported row.
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, sav, pg_temp.cat(u, 'Deposits'), 310.45, 'Income', date '2026-10-07', 'savings side')
  returning id into inc;
  perform public.import_transactions(chk, jsonb_build_array(
    jsonb_build_object('row', 2, 'date', '2026-10-06', 'cents', 31045, 'type', 'Expense', 'description', 'TFR TO SAV',
      'transfer', jsonb_build_object('other_accountid', sav, 'pair_with', inc)),
    jsonb_build_object('row', 3, 'date', '2026-10-10', 'cents', 4242, 'type', 'Expense', 'description', 'imported',
      'categoryid', pg_temp.cat(u, 'Groceries'))), null, null);

  -- A schedule nobody has confirmed: no row, so not counted.
  insert into public.recurring_transactions
    (userid, accountid, categoryid, description, amount, frequency, next_run_date, start_date, next_due_date)
  values (u, chk, pg_temp.cat(u, 'Rent'), 'unconfirmed', 99, 'Monthly',
          date '2026-10-20', date '2026-10-20', date '2026-10-20');

  perform pg_temp.rec('ny: the fixtures'' three transfers are six legs', '6',
    (select count(*)::text from public.transactions where transfer_group_id is not null));
  perform pg_temp.compare('ny', 'income',   5020.09, 3);
  perform pg_temp.compare('ny', 'spending', 2057.16, 7);
  perform pg_temp.unbecome();

  perform pg_temp.become(a);
  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (achk, a, 'Flow checking', 'Checking', 5000, date '2026-01-01');
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (a, achk, pg_temp.cat(a, 'Paychecks/Salary'), 1200.55, 'Income',  date '2026-10-01', 'pay'),
         (a, achk, pg_temp.cat(a, 'Restaurants'),        23.30, 'Expense', date '2026-10-31', '23:30 last day'),
         (a, achk, pg_temp.cat(a, 'Groceries'),          60.00, 'Expense', date '2026-10-12', 'groceries'),
         (a, achk, pg_temp.cat(a, 'Groceries'),           5.00, 'Expense', date '2026-11-01', 'next month');
  perform pg_temp.compare('akl', 'income',   1200.55, 1);
  perform pg_temp.compare('akl', 'spending',   83.30, 2);
  perform pg_temp.unbecome();
end
$$;

-- The summary is the LAST row: 2 date rows + 1 leg row + 16 comparisons.
with tally as (
  select count(*) as total, count(*) filter (where not pass) as failed from fs_results
)
select check_ as check, expected, actual, pass
  from (select seq, check_, expected, actual, pass from fs_results
        union all
        select 2147483647, 'SUMMARY', '19 rows, 0 false, ALL PASS',
               t.total || ' rows, ' || t.failed || ' false -- '
                 || case when t.failed = 0 and t.total = 19 then 'ALL PASS' else 'NOT PASSED' end,
               t.failed = 0 and t.total = 19
          from tally t) x
 order by seq;

rollback;
