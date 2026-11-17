-- =====================================================================
-- Debt goals that follow a card (migration 70)
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/debt-goal-test.sql
--
-- Writes, then rolls back: Matt runs it (CLAUDE.md). Returns one row per
-- assertion; a run is clean only when every `pass` is true. Throwaway
-- users, one transaction, ROLLBACK. Cleanup check (must be 0):
--   select count(*) from auth.users where email like 'dg-test-%@example.invalid';
--
-- The card owes $2,000 when the goal starts following it. Dates are
-- relative to today (the session's day; the test users have no timezone,
-- so their day is UTC's, the same as the session's).
--
--   1  is_liability_account_type(): Credit Card and Loan only.
--   2  Linking is refused for a goal that isn't Debt Payoff, an account
--      that isn't a liability, a card that owes nothing, and a direct
--      write to the link columns (42501).
--   3  Linked: starting $2,000, owed $2,000, 0%, to go $2,000. The goal's
--      earlier hand entries stay in its history (v_goal_money) and don't
--      count.
--   4  A followed goal takes no contribution and no linked transaction.
--   5  A $500 payment: owed $1,500, 25%, to go $1,500.
--   6  $30 of interest logged: to go $1,530, 23.5% -- the true figure.
--   7  A followed goal holds nothing in safe to spend.
--   8  Paying to zero completes it (once): 100%, to go $0. In the gap
--      before completed_at is written (owner clears it), the view still
--      reads paid off -- is_paid_off, 100%, $0 to go -- never 100% alone.
--   9  STICKY: a later charge doesn't reopen it, and editing that later
--      charge doesn't either. The goal rests at 100%.
--  10  Deleting the payment that completed it (dated before the
--      completion day) reopens it.
--  11  Paying again completes it again. A NEW charge dated on the
--      completion day (as an import would add) reopens it, showing what's
--      to go; paying that completes it again. Owing a cent reads 99.9%,
--      never 100%.
--  12  Unlinking a paid-off goal keeps it paid off: one carried-over
--      contribution of the starting balance; target = history + that.
--  13  Unlinking a goal part-way keeps "to go": a $1,000 loan, $300 paid,
--      unlinks to $300 carried over and $700 to go.
--  14  Changing a followed goal's type is refused until it's unlinked.
--  15  Archiving the card unlinks its goal, keeping the number.
--  16  RLS: another user can't link my goal, or their goal to my card,
--      and calling sync_card_goal_completion() on my goal changes nothing.
--  17  v_goal_progress and v_goal_monthly_holds carry production's ACL
--      and are security_invoker.
--  18  user_day() after migration 71 equals 70's inline expression for a
--      null zone, an unknown name, a wrong-case name, no settings row and
--      a real zone (which must move the day: the control).
-- =====================================================================

begin;

create temp table dg_results (
  seq      serial primary key,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
grant insert, select on dg_results to authenticated;
grant usage on sequence dg_results_seq_seq to authenticated;

create function pg_temp.rec(p_check text, p_expected text, p_actual text) returns void
language sql as $$
  insert into dg_results (check_, expected, actual, pass)
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

-- The SQLSTATE a statement raises, or 'ok'.
create function pg_temp.state_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end
$$;

insert into auth.users (id, instance_id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('d9000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'dg-test-a@example.invalid', '{}'::jsonb,
        '{"first_name": "Dg", "last_name": "Test"}'::jsonb, now(), now()),
       ('d9000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'dg-test-b@example.invalid', '{}'::jsonb,
        '{"first_name": "Dg", "last_name": "Other"}'::jsonb, now(), now());

do $$
declare
  u       constant uuid := 'd9000000-0000-4000-8000-000000000001';
  other   constant uuid := 'd9000000-0000-4000-8000-000000000002';
  chk     constant uuid := 'd9000000-0000-4000-8000-000000000011';
  visa    constant uuid := 'd9000000-0000-4000-8000-000000000012';
  loan    constant uuid := 'd9000000-0000-4000-8000-000000000013';
  paid    constant uuid := 'd9000000-0000-4000-8000-000000000014';
  card2   constant uuid := 'd9000000-0000-4000-8000-000000000015';
  o_card  constant uuid := 'd9000000-0000-4000-8000-000000000021';
  g       constant uuid := 'd9000000-0000-4000-8000-000000000031';
  g_trip  constant uuid := 'd9000000-0000-4000-8000-000000000032';
  g_loan  constant uuid := 'd9000000-0000-4000-8000-000000000033';
  g_arch  constant uuid := 'd9000000-0000-4000-8000-000000000034';
  o_goal  constant uuid := 'd9000000-0000-4000-8000-000000000041';
  p1      uuid := gen_random_uuid();
  p2      uuid := gen_random_uuid();
  p3      uuid := gen_random_uuid();
  p4      uuid := gen_random_uuid();
  p5      uuid := gen_random_uuid();
  p6      uuid := gen_random_uuid();
  p7      uuid := gen_random_uuid();
  p8      uuid := gen_random_uuid();
  cat     uuid;
  charge  uuid;
  v       record;
  t       text;
  n       bigint;
begin
  perform pg_temp.become(u);

  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (chk,   u, 'DG checking', 'Checking',    9000,  current_date - 60),
         (visa,  u, 'DG Visa',     'Credit Card', -2000, current_date - 60),
         (loan,  u, 'DG loan',     'Loan',        -1000, current_date - 60),
         (paid,  u, 'DG paid',     'Credit Card', 0,     current_date - 60),
         (card2, u, 'DG card two', 'Credit Card', -400,  current_date - 60);

  select id into cat from public.categories where userid = u and category_type = 'Expense' order by category_name limit 1;

  insert into public.goals (id, userid, goal_name, goal_type, target_amount, monthly_contribution)
  values (g,      u, 'Visa payoff', 'Debt Payoff', 2000, 300),
         (g_trip, u, 'Trip',        'Vacation',    1000, null),
         (g_loan, u, 'Loan payoff', 'Debt Payoff', 1000, null),
         (g_arch, u, 'Card two',    'Debt Payoff', 400,  null);

  -- Two earlier hand entries: they stay in the goal's history.
  insert into public.goal_contributions (userid, goalid, amount, date, funding_method)
  values (u, g, 100, current_date - 40, 'manual'),
         (u, g, 100, current_date - 30, 'manual');

  -- 1 ------------------------------------------------------------------
  perform pg_temp.rec('1 Credit Card and Loan are liabilities', 'true,true',
    public.is_liability_account_type('Credit Card')::text || ',' || public.is_liability_account_type('Loan')::text);
  select count(*) into n from unnest(array['Checking', 'Savings', 'Cash', 'Investment', 'Other']) x(k)
   where public.is_liability_account_type(x.k);
  perform pg_temp.rec('1 nothing else is', '0', n::text);
  perform pg_temp.rec('1 null is not', 'false', public.is_liability_account_type(null)::text);

  -- 2 ------------------------------------------------------------------
  perform pg_temp.rec('2 a vacation goal can''t follow a card', '23514',
    pg_temp.state_of(format('select public.link_goal_to_card(%L, %L)', g_trip, visa)));
  perform pg_temp.rec('2 a goal can''t follow checking', '23514',
    pg_temp.state_of(format('select public.link_goal_to_card(%L, %L)', g, chk)));
  perform pg_temp.rec('2 a card that owes nothing can''t be followed', '23514',
    pg_temp.state_of(format('select public.link_goal_to_card(%L, %L)', g, paid)));
  perform pg_temp.rec('2 writing the link columns directly is refused', '42501',
    pg_temp.state_of(format('update public.goals set tracking_method = %L, accountid = %L, starting_balance = 2000, linked_at = now() where id = %L', 'LinkedAccount', visa, g)));

  -- 3 ------------------------------------------------------------------
  perform public.link_goal_to_card(g, visa);
  select * into v from public.v_goal_progress where goal_id = g;
  perform pg_temp.rec('3 starting balance recorded', '2000.00', v.starting_balance::text);
  perform pg_temp.rec('3 linked: owed, to go, meter', '2000.00|2000.00|0.0',
    v.owed_amount::numeric(12,2)::text || '|' || v.remaining_amount::numeric(12,2)::text || '|' || v.pct_complete::text);
  perform pg_temp.rec('3 the account name is carried', 'DG Visa', v.linked_account_name);
  select count(*) into n from public.v_goal_money where goalid = g;
  perform pg_temp.rec('3 earlier hand entries stay in its history', '2', n::text);
  perform pg_temp.rec('3 and don''t count', '0.00', v.contributed_amount::numeric(12,2)::text);

  -- 4 ------------------------------------------------------------------
  perform pg_temp.rec('4 no contribution to a followed goal', '23514',
    pg_temp.state_of(format('insert into public.goal_contributions (userid, goalid, amount, date, funding_method) values (%L, %L, 50, current_date, %L)', u, g, 'manual')));
  perform pg_temp.rec('4 no transaction linked to a followed goal', '23514',
    pg_temp.state_of(format('insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description, goalid) values (%L, %L, %L, 50, %L, current_date, %L, %L)', u, chk, cat, 'Expense', 'For a followed goal', g)));

  -- 5 ------------------------------------------------------------------
  insert into public.transactions (userid, accountid, amount, transaction_type, transaction_date, description, transfer_group_id)
  values (u, chk,  500, 'Expense', current_date - 12, 'Visa payment', p1),
         (u, visa, 500, 'Income',  current_date - 12, 'Visa payment', p1);
  select * into v from public.v_goal_progress where goal_id = g;
  perform pg_temp.rec('5 a payment moves owed, to go and the meter', '1500.00|1500.00|25.0',
    v.owed_amount::numeric(12,2)::text || '|' || v.remaining_amount::numeric(12,2)::text || '|' || v.pct_complete::text);

  -- 6 ------------------------------------------------------------------
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, visa, cat, 30, 'Expense', current_date - 11, 'Interest');
  select * into v from public.v_goal_progress where goal_id = g;
  perform pg_temp.rec('6 interest moves to go up, the meter down -- the true figure', '1530.00|23.5',
    v.remaining_amount::numeric(12,2)::text || '|' || v.pct_complete::text);
  perform pg_temp.rec('6 not complete', '<null>', coalesce(v.completed_at::text, '<null>'));

  -- 7 ------------------------------------------------------------------
  select count(*) into n from public.v_goal_monthly_holds where goalid = g;
  perform pg_temp.rec('7 a followed goal holds nothing', '0', n::text);

  -- 8 ------------------------------------------------------------------
  insert into public.transactions (userid, accountid, amount, transaction_type, transaction_date, description, transfer_group_id)
  values (u, chk,  1530, 'Expense', current_date - 10, 'Visa payoff payment', p2),
         (u, visa, 1530, 'Income',  current_date - 10, 'Visa payoff payment', p2);
  select * into v from public.v_goal_progress where goal_id = g;
  perform pg_temp.rec('8 paid to zero: complete, 100%, $0 to go', 'true|100.0|0.00',
    (v.completed_at is not null)::text || '|' || v.pct_complete::text || '|' || v.remaining_amount::numeric(12,2)::text);
  perform pg_temp.rec('8 is_paid_off', 'true', v.is_paid_off::text);

  -- The gap: owing nothing, completed_at not yet written.
  perform pg_temp.unbecome();
  perform set_config('sorrel.goal_completion', 'on', true);
  update public.goals set completed_at = null where id = g;
  perform set_config('sorrel.goal_completion', '', true);
  perform pg_temp.become(u);
  select * into v from public.v_goal_progress where goal_id = g;
  perform pg_temp.rec('8 the gap reads paid off, no date: is_paid_off, 100%, $0 to go, completed_at null',
    'true|100.0|0.00|<null>',
    v.is_paid_off::text || '|' || v.pct_complete::text || '|' || v.remaining_amount::numeric(12,2)::text || '|' || coalesce(v.completed_at::text, '<null>'));

  -- Recorded nine days ago, as if the completing payment were entered then
  -- (owner, through the completion gate), so "after the completion day"
  -- has room.
  perform pg_temp.unbecome();
  perform set_config('sorrel.goal_completion', 'on', true);
  update public.goals set completed_at = now() - interval '9 days' where id = g;
  perform set_config('sorrel.goal_completion', '', true);
  perform pg_temp.become(u);

  -- 9 ------------------------------------------------------------------
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, visa, cat, 40, 'Expense', current_date - 2, 'New charge')
  returning id into charge;
  select * into v from public.v_goal_progress where goal_id = g;
  perform pg_temp.rec('9 a later charge doesn''t reopen it', 'true', (v.completed_at is not null)::text);
  perform pg_temp.rec('9 it rests at 100%, nothing to go', '100.0|0.00',
    v.pct_complete::text || '|' || v.remaining_amount::numeric(12,2)::text);
  perform pg_temp.rec('9 the card''s own figure still shows the charge', '40.00', v.owed_amount::numeric(12,2)::text);
  update public.transactions set amount = 60 where id = charge;
  select (completed_at is not null)::text into t from public.goals where id = g;
  perform pg_temp.rec('9 editing that later charge doesn''t either', 'true', t);
  update public.transactions set description = 'Interest, renamed' where accountid = visa and description = 'Interest';
  select (completed_at is not null)::text into t from public.goals where id = g;
  perform pg_temp.rec('9 renaming an earlier row doesn''t re-assess it', 'true', t);

  -- 10 -----------------------------------------------------------------
  delete from public.transactions where transfer_group_id = p2;
  select * into v from public.v_goal_progress where goal_id = g;
  perform pg_temp.rec('10 deleting the payment that completed it reopens it', '<null>', coalesce(v.completed_at::text, '<null>'));
  perform pg_temp.rec('10 and to go is what the card owes', '1590.00', v.remaining_amount::numeric(12,2)::text);

  -- 11 -----------------------------------------------------------------
  insert into public.transactions (userid, accountid, amount, transaction_type, transaction_date, description, transfer_group_id)
  values (u, chk,  1590, 'Expense', current_date, 'Visa payoff, again', p3),
         (u, visa, 1590, 'Income',  current_date, 'Visa payoff, again', p3);
  select (completed_at is not null)::text into t from public.goals where id = g;
  perform pg_temp.rec('11 paying again completes it again', 'true', t);

  -- A new charge dated on the completion day (today), as an import adds.
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, visa, cat, 25, 'Expense', current_date, 'Imported charge');
  select * into v from public.v_goal_progress where goal_id = g;
  perform pg_temp.rec('11 a new charge dated on the completion day reopens it, showing what''s to go', '<null>|false|25.00',
    coalesce(v.completed_at::text, '<null>') || '|' || v.is_paid_off::text || '|' || v.remaining_amount::numeric(12,2)::text);

  -- Pay all but a cent: still not paid off, so never 100%.
  insert into public.transactions (userid, accountid, amount, transaction_type, transaction_date, description, transfer_group_id)
  values (u, chk,  24.99, 'Expense', current_date, 'Almost', p6),
         (u, visa, 24.99, 'Income',  current_date, 'Almost', p6);
  select * into v from public.v_goal_progress where goal_id = g;
  perform pg_temp.rec('11 owing a cent reads 99.9%, not paid off', '99.9|false|0.01',
    v.pct_complete::text || '|' || v.is_paid_off::text || '|' || v.remaining_amount::numeric(12,2)::text);

  insert into public.transactions (userid, accountid, amount, transaction_type, transaction_date, description, transfer_group_id)
  values (u, chk,  0.01, 'Expense', current_date, 'The cent', p7),
         (u, visa, 0.01, 'Income',  current_date, 'The cent', p7);
  select (completed_at is not null)::text into t from public.goals where id = g;
  perform pg_temp.rec('11 paying the rest completes it again', 'true', t);

  -- 12 -----------------------------------------------------------------
  perform pg_temp.rec('12 unlinking a paid-off goal carries over the starting balance', '2000.00',
    public.unlink_goal_from_card(g)::numeric(12,2)::text);
  select * into v from public.v_goal_progress where goal_id = g;
  perform pg_temp.rec('12 manual again, still paid off', 'Manual|true|0.00|100.0',
    v.tracking_method || '|' || (v.completed_at is not null)::text || '|' || v.remaining_amount::numeric(12,2)::text || '|' || v.pct_complete::text);
  perform pg_temp.rec('12 target = history + carried over', '2200.00', v.target_amount::numeric(12,2)::text);
  select count(*) into n from public.goal_contributions where goalid = g and funding_method = 'carried_over';
  perform pg_temp.rec('12 one carried-over contribution', '1', n::text);

  -- 13 -----------------------------------------------------------------
  perform public.link_goal_to_card(g_loan, loan);
  insert into public.transactions (userid, accountid, amount, transaction_type, transaction_date, description, transfer_group_id)
  values (u, chk,  300, 'Expense', current_date, 'Loan payment', p4),
         (u, loan, 300, 'Income',  current_date, 'Loan payment', p4);
  select remaining_amount::numeric(12,2)::text into t from public.v_goal_progress where goal_id = g_loan;
  perform pg_temp.rec('13 (fixture) $700 to go while following', '700.00', t);
  perform pg_temp.rec('13 unlink carries over the $300', '300.00', public.unlink_goal_from_card(g_loan)::numeric(12,2)::text);
  select * into v from public.v_goal_progress where goal_id = g_loan;
  perform pg_temp.rec('13 to go unchanged after unlinking', '700.00|300.00|30.0',
    v.remaining_amount::numeric(12,2)::text || '|' || v.contributed_amount::numeric(12,2)::text || '|' || v.pct_complete::text);

  -- 14 -----------------------------------------------------------------
  perform public.link_goal_to_card(g_loan, loan);
  perform pg_temp.rec('14 a followed goal can''t change type in place', '23514',
    pg_temp.state_of(format('update public.goals set goal_type = %L where id = %L', 'Vacation', g_loan)));
  perform public.unlink_goal_from_card(g_loan);
  perform pg_temp.rec('14 unlinked first, it can', 'ok',
    pg_temp.state_of(format('update public.goals set goal_type = %L where id = %L', 'Vacation', g_loan)));

  -- 15 -----------------------------------------------------------------
  perform public.link_goal_to_card(g_arch, card2);
  insert into public.transactions (userid, accountid, amount, transaction_type, transaction_date, description, transfer_group_id)
  values (u, chk,   100, 'Expense', current_date, 'Card two payment', p5),
         (u, card2, 100, 'Income',  current_date, 'Card two payment', p5);
  update public.accounts set is_active = false where id = card2;
  select * into v from public.v_goal_progress where goal_id = g_arch;
  perform pg_temp.rec('15 archiving the card unlinks its goal, keeping to go', 'Manual|300.00|100.00',
    v.tracking_method || '|' || v.remaining_amount::numeric(12,2)::text || '|' || v.contributed_amount::numeric(12,2)::text);

  -- 16 -----------------------------------------------------------------
  perform pg_temp.unbecome();
  perform pg_temp.become(other);
  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (o_card, other, 'Other card', 'Credit Card', -500, current_date - 60);
  insert into public.goals (id, userid, goal_name, goal_type, target_amount)
  values (o_goal, other, 'Other payoff', 'Debt Payoff', 500);
  perform pg_temp.rec('16 another user can''t link my goal', 'P0002',
    pg_temp.state_of(format('select public.link_goal_to_card(%L, %L)', g_arch, o_card)));
  perform pg_temp.rec('16 nor their goal to my card', 'P0002',
    pg_temp.state_of(format('select public.link_goal_to_card(%L, %L)', o_goal, loan)));
  select count(*) into n from public.v_goal_progress where goal_id in (g, g_loan, g_arch);
  perform pg_temp.rec('16 another user sees none of my goals', '0', n::text);
  perform pg_temp.unbecome();

  -- My followed goal, paid off, with completed_at cleared by the owner:
  -- the other user calling the sync on it must not write it.
  perform pg_temp.become(u);
  perform public.link_goal_to_card(g_arch, loan);
  insert into public.transactions (userid, accountid, amount, transaction_type, transaction_date, description, transfer_group_id)
  values (u, chk,  700, 'Expense', current_date, 'Loan payoff', p8),
         (u, loan, 700, 'Income',  current_date, 'Loan payoff', p8);
  perform pg_temp.unbecome();
  perform set_config('sorrel.goal_completion', 'on', true);
  update public.goals set completed_at = null where id = g_arch;
  perform set_config('sorrel.goal_completion', '', true);
  perform pg_temp.become(other);
  perform public.sync_card_goal_completion(g_arch, array[current_date], true);
  perform pg_temp.unbecome();
  select coalesce(completed_at::text, '<null>') into t from public.goals where id = g_arch;
  perform pg_temp.rec('16 another user''s sync call writes nothing to my goal', '<null>', t);
  perform pg_temp.become(u);
  perform public.sync_card_goal_completion(g_arch, array[current_date], true);
  perform pg_temp.unbecome();
  select (completed_at is not null)::text into t from public.goals where id = g_arch;
  perform pg_temp.rec('16 control: my own sync call completes it', 'true', t);
end
$$;

-- 17 -------------------------------------------------------------------
select pg_temp.rec('17 v_goal_progress ACL',
                   'postgres=arwdDxtm/postgres authenticated=rDxtm/postgres service_role=Dxtm/postgres',
                   (select array_to_string(relacl, ' ') from pg_class where oid = 'public.v_goal_progress'::regclass));
select pg_temp.rec('17 v_goal_progress is security_invoker', 'security_invoker=true',
                   (select array_to_string(reloptions, ',') from pg_class where oid = 'public.v_goal_progress'::regclass));
select pg_temp.rec('17 v_goal_monthly_holds ACL',
                   'postgres=arwdDxtm/postgres authenticated=rDxtm/postgres service_role=Dxtm/postgres',
                   (select array_to_string(relacl, ' ') from pg_class where oid = 'public.v_goal_monthly_holds'::regclass));
select pg_temp.rec('17 anon cannot read v_goal_progress', 'false',
                   has_table_privilege('anon', 'public.v_goal_progress', 'select')::text);

-- 18 -------------------------------------------------------------------
-- user_day() (redefined on user_time_zone() in migration 71) gives exactly
-- what migration 70's inline expression gave, for the zones only a written
-- row can produce: null, an unknown name, a wrong-case name, no settings
-- row at all -- and a real zone whose day differs from UTC's (the control:
-- a test where every case falls back to UTC would pass vacuously). Run as
-- the table owner; the transaction rolls back.
do $$
declare
  u     constant uuid := 'd9000000-0000-4000-8000-000000000001';
  other constant uuid := 'd9000000-0000-4000-8000-000000000002';
  at    constant timestamptz := '2026-11-16 12:00:00+00';
  c     record;
  v_new date;
  v_old date;
begin
  for c in
    select * from (values
      ('null timezone',          'null'),
      ('unknown zone name',      'Mars/Olympus'),
      ('wrong-case zone name',   'pacific/kiritimati'),
      ('real zone, UTC+14',      'Pacific/Kiritimati'),
      ('no settings row',        '<delete>')
    ) as t(label, zone)
  loop
    if c.zone = '<delete>' then
      delete from public.settings where userid = other;
    else
      update public.settings set timezone = nullif(c.zone, 'null') where userid = other;
    end if;

    v_new := public.user_day(other, at);
    v_old := (at at time zone coalesce(
                (select s.timezone
                   from public.settings s
                  where s.userid = other
                    and s.timezone in (select name from pg_catalog.pg_timezone_names)),
                'UTC'))::date;
    perform pg_temp.rec('18 user_day = 70''s expression: ' || c.label,
                        coalesce(v_old::text, '<null>'), coalesce(v_new::text, '<null>'));
  end loop;

  -- The control: the real zone moved the day (UTC's is the 16th).
  update public.settings set timezone = 'Pacific/Kiritimati' where userid = u;
  perform pg_temp.rec('18 control: a real zone moves the day', '2026-11-17', public.user_day(u, at)::text);
  perform pg_temp.rec('18 fallback: no settings row reads UTC', '2026-11-16', public.user_day(other, at)::text);
end
$$;

select seq, check_, expected, actual, pass from dg_results order by seq;

rollback;
