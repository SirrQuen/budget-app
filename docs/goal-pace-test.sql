-- =====================================================================
-- goal_pace() test (migration 72, docs/Decide-and-Grow.md section H)
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/goal-pace-test.sql
--
-- It writes, then rolls back, so it isn't --read-only and the CLI asks
-- for confirmation: Matt runs it. To check migration 72 before it's
-- pushed, put its statements right after BEGIN.
--
-- Every check runs AS the user -- role authenticated, request.jwt.claims
-- set, exactly as PostgREST does -- so RLS, auth.uid() and
-- account_balance_as_of()'s counts_in_balance() apply as in a request.
-- Self-cleaning: one throwaway user, one transaction, ROLLBACK. Cleanup
-- check (must be 0):
--   select count(*) from auth.users where email like 'gp-test-%@example.invalid';
--
-- Months are relative to today: m0 = this month, m1 = last month, m2 and
-- m3 the two before it. The window is m3..m1. Clean only when every
-- `pass` is true.
--
--   1  A card paid down $100, $200, $300 over the window: pace $200, the
--      $600 still owed blooms in m0 + 3.
--   2  A card whose balance date is inside the window: not enough history
--      (the recap's balance-date rule).
--   3  A card that owes more than at the window's start: no pace, no
--      bloom month -- the line is hidden.
--   4  The Japan-trip shape: $400 + $650 over the window, $1,950 to go,
--      target 5 months out: pace $350, blooms m0 + 6, not on pace, $390 a
--      month would reach it.
--   5  The same, target 12 months out: on pace, no amount named.
--   6  Money in only one window month (plus some this month): not enough.
--   7  carried_over is excluded: $500 carried over in m1 + $100 in m2 and
--      m3 is a $66.67 pace.
--   8  A target date already past, or in this month: treated as no date.
--   9  A reached goal: complete, no pace.
--  10  Another user sees none of these goals.
--  11  The dev test user's real figures (sorrel-dev only; skipped where
--      that user doesn't exist): Japan trip, as of November 2026.
-- =====================================================================

begin;

create temp table gp_results (
  seq      serial primary key,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
grant insert, select on gp_results to authenticated;
grant usage on sequence gp_results_seq_seq to authenticated;

create function pg_temp.rec(p_check text, p_expected text, p_actual text) returns void
language sql as $$
  insert into gp_results (check_, expected, actual, pass)
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

-- One goal_pace() row as text, read as the current role.
create function pg_temp.pace_of(p_goal uuid) returns text language sql as $$
  select concat_ws('|', p.state, coalesce(p.pace::numeric(12,2)::text, 'null'),
                   coalesce(p.bloom_month::text, 'null'), coalesce(p.target_month::text, 'null'),
                   coalesce(p.on_pace::text, 'null'), coalesce(p.needed_monthly::numeric(12,0)::text, 'null'))
    from public.goal_pace() p
   where p.goal_id = p_goal
$$;

insert into auth.users (id, instance_id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('9a000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'gp-test-a@example.invalid', '{}'::jsonb,
        '{"first_name": "Gp", "last_name": "Test"}'::jsonb, now(), now()),
       ('9a000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'gp-test-b@example.invalid', '{}'::jsonb,
        '{"first_name": "Gp", "last_name": "Other"}'::jsonb, now(), now());

do $$
declare
  u       constant uuid := '9a000000-0000-4000-8000-000000000001';
  other   constant uuid := '9a000000-0000-4000-8000-000000000002';
  chk     constant uuid := '9a000000-0000-4000-8000-000000000011';
  visa    constant uuid := '9a000000-0000-4000-8000-000000000012';
  newcard constant uuid := '9a000000-0000-4000-8000-000000000013';
  upcard  constant uuid := '9a000000-0000-4000-8000-000000000014';
  g_visa  constant uuid := '9a000000-0000-4000-8000-000000000021';
  g_new   constant uuid := '9a000000-0000-4000-8000-000000000022';
  g_up    constant uuid := '9a000000-0000-4000-8000-000000000023';
  g_trip  constant uuid := '9a000000-0000-4000-8000-000000000031';
  g_far   constant uuid := '9a000000-0000-4000-8000-000000000032';
  g_once  constant uuid := '9a000000-0000-4000-8000-000000000033';
  g_carry constant uuid := '9a000000-0000-4000-8000-000000000034';
  g_past  constant uuid := '9a000000-0000-4000-8000-000000000035';
  g_now   constant uuid := '9a000000-0000-4000-8000-000000000036';
  g_done  constant uuid := '9a000000-0000-4000-8000-000000000037';
  m0      constant date := date_trunc('month', current_date::timestamp)::date;
  m1      constant date := (m0 - interval '1 month')::date;
  m2      constant date := (m0 - interval '2 months')::date;
  m3      constant date := (m0 - interval '3 months')::date;
  cat     uuid;
  n       bigint;
begin
  perform pg_temp.become(u);
  select id into cat from public.categories where userid = u and category_type = 'Expense' order by category_name limit 1;

  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (chk,     u, 'GP checking', 'Checking',    20000, m3 - 10),
         (visa,    u, 'GP Visa',     'Credit Card', -1200, m3 - 10),
         (newcard, u, 'GP new card', 'Credit Card', -500,  m3 + 5),
         (upcard,  u, 'GP up card',  'Credit Card', -300,  m3 - 10);

  -- 1: three payments, one in each window month.
  insert into public.transactions (userid, accountid, amount, transaction_type, transaction_date, description, transfer_group_id)
  select u, x.acct, x.amt, x.typ, x.d, 'Visa payment', x.grp
    from (values (chk, 100, 'Expense', m3 + 3, '9a000000-0000-4000-8000-0000000000a1'::uuid),
                 (visa, 100, 'Income', m3 + 3, '9a000000-0000-4000-8000-0000000000a1'::uuid),
                 (chk, 200, 'Expense', m2 + 3, '9a000000-0000-4000-8000-0000000000a2'::uuid),
                 (visa, 200, 'Income', m2 + 3, '9a000000-0000-4000-8000-0000000000a2'::uuid),
                 (chk, 300, 'Expense', m1 + 3, '9a000000-0000-4000-8000-0000000000a3'::uuid),
                 (visa, 300, 'Income', m1 + 3, '9a000000-0000-4000-8000-0000000000a3'::uuid))
         as x(acct, amt, typ, d, grp);
  -- 3: a charge, so the card owes more at the end than at the start.
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, upcard, cat, 100, 'Expense', m1 + 3, 'A charge');

  insert into public.goals (id, userid, goal_name, goal_type, target_amount, target_date)
  values (g_visa,  u, 'Visa payoff',  'Debt Payoff', 1200, null),
         (g_new,   u, 'New card',     'Debt Payoff', 500,  null),
         (g_up,    u, 'Up card',      'Debt Payoff', 300,  null),
         (g_trip,  u, 'Trip',         'Vacation',    3000, (m0 + interval '5 months')::date + 24),
         (g_far,   u, 'Far trip',     'Vacation',    3000, (m0 + interval '12 months')::date + 24),
         (g_once,  u, 'Once',         'Custom',      1000, null),
         (g_carry, u, 'Carried',      'Custom',      5000, null),
         (g_past,  u, 'Past date',    'Custom',      3000, m0 - 20),
         (g_now,   u, 'This month',   'Custom',      3000, (m0 + interval '1 month' - interval '1 day')::date),
         (g_done,  u, 'Done',         'Custom',      100,  null);

  perform public.link_goal_to_card(g_visa, visa);
  perform public.link_goal_to_card(g_new,  newcard);
  perform public.link_goal_to_card(g_up,   upcard);

  insert into public.goal_contributions (userid, goalid, amount, date, funding_method)
  values (u, g_trip,  400, m2 + 1,       'manual'),
         (u, g_trip,  650, m1 + 1,       'manual'),
         (u, g_far,   400, m2 + 1,       'manual'),
         (u, g_far,   650, m1 + 1,       'manual'),
         (u, g_once,  300, m1 + 1,       'manual'),
         (u, g_once,  200, current_date, 'manual'),
         (u, g_carry, 100, m3 + 1,       'manual'),
         (u, g_carry, 100, m2 + 1,       'manual'),
         (u, g_past,  400, m2 + 1,       'manual'),
         (u, g_past,  650, m1 + 1,       'manual'),
         (u, g_now,   400, m2 + 1,       'manual'),
         (u, g_now,   650, m1 + 1,       'manual'),
         (u, g_done,  60,  m2 + 1,       'manual'),
         (u, g_done,  60,  m1 + 1,       'manual');
  perform pg_temp.unbecome();

  -- 7's carried-over entry is what an unlink writes (70); written here as
  -- the table owner, the way that function does.
  insert into public.goal_contributions (userid, goalid, amount, date, funding_method)
  values (u, g_carry, 500, m1 + 1, 'carried_over');

  perform pg_temp.become(u);

  perform pg_temp.rec('1 card paid down 100/200/300: pace 200, $600 blooms m0+3',
    concat_ws('|', 'pace', '200.00', (m0 + interval '3 months')::date::text, 'null', 'null', 'null'),
    pg_temp.pace_of(g_visa));
  perform pg_temp.rec('2 balance date inside the window: not enough history',
    'not_enough|null|null|null|null|null', pg_temp.pace_of(g_new));
  perform pg_temp.rec('3 card owes more than at the start: no pace',
    'no_pace|null|null|null|null|null', pg_temp.pace_of(g_up));
  perform pg_temp.rec('4 Japan shape: pace 350, blooms m0+6, $390 by m0+5',
    concat_ws('|', 'pace', '350.00', (m0 + interval '6 months')::date::text,
              (m0 + interval '5 months')::date::text, 'false', '390'),
    pg_temp.pace_of(g_trip));
  perform pg_temp.rec('5 target 12 months out: on pace, no amount',
    concat_ws('|', 'pace', '350.00', (m0 + interval '6 months')::date::text,
              (m0 + interval '12 months')::date::text, 'true', 'null'),
    pg_temp.pace_of(g_far));
  perform pg_temp.rec('6 one window month (and this month): not enough',
    'not_enough|null|null|null|null|null', pg_temp.pace_of(g_once));
  perform pg_temp.rec('7 carried_over excluded: (100 + 100) / 3',
    '66.67', split_part(pg_temp.pace_of(g_carry), '|', 2));
  perform pg_temp.rec('8a a past target date is no date',
    'null|null|null', split_part(pg_temp.pace_of(g_past), '|', 4) || '|'
      || split_part(pg_temp.pace_of(g_past), '|', 5) || '|' || split_part(pg_temp.pace_of(g_past), '|', 6));
  perform pg_temp.rec('8b a target date this month is no date',
    'null|null|null', split_part(pg_temp.pace_of(g_now), '|', 4) || '|'
      || split_part(pg_temp.pace_of(g_now), '|', 5) || '|' || split_part(pg_temp.pace_of(g_now), '|', 6));
  perform pg_temp.rec('9 a reached goal: complete, no pace',
    'complete|null|null|null|null|null', pg_temp.pace_of(g_done));

  -- The debt pace equals the month-end balances read directly, as the user.
  perform pg_temp.rec('1b debt pace = (balance at m1 end - balance at m3 start) / 3, as the user',
    round((public.account_balance_as_of(visa, m0 - 1) - public.account_balance_as_of(visa, m3 - 1)) / 3, 2)::text,
    split_part(pg_temp.pace_of(g_visa), '|', 2));
  perform pg_temp.unbecome();

  -- 10 -----------------------------------------------------------------
  perform pg_temp.become(other);
  select count(*) into n from public.goal_pace();
  perform pg_temp.unbecome();
  perform pg_temp.rec('10 another user sees none of these goals', '0', n::text);
end
$$;

-- 11 -------------------------------------------------------------------
-- The dev test user's Japan trip, from goal_pace() as that user. Valid in
-- November 2026 only (the window is Aug-Oct): $400 Sep + $650 Oct = $350
-- a month; $1,950 to go blooms May 2027; target 25 Apr 2027 -> April;
-- $1,950 / 5 = $390. Their followed cards, if any, are checked against
-- their month-end balances read directly. Nothing is recorded where the
-- user doesn't exist (any project but sorrel-dev).
do $$
declare
  dev constant uuid := '7e9a84e3-90b3-4cca-b6d1-d640128a77d8';
  r      record;
  v_drop numeric;
  m0     constant date := date_trunc('month', current_date::timestamp)::date;
begin
  if not exists (select 1 from auth.users where id = dev) then
    return;
  end if;
  perform pg_temp.become(dev);
  for r in
    select g.id, g.goal_name, g.tracking_method, g.accountid, a.opening_date
      from public.goals g
      left join public.accounts a on a.id = g.accountid
     where g.is_active
  loop
    if r.goal_name = 'Japan trip' and m0 = '2026-11-01' then
      perform pg_temp.rec('11 dev Japan trip: 350, May, April, not on pace, $390',
        'pace|350.00|2027-05-01|2027-04-01|false|390', pg_temp.pace_of(r.id));
    elsif r.tracking_method = 'LinkedAccount'
          and r.opening_date <= (m0 - interval '3 months')::date - 1
          and split_part(pg_temp.pace_of(r.id), '|', 1) <> 'complete' then
      v_drop := public.account_balance_as_of(r.accountid, m0 - 1)
                - public.account_balance_as_of(r.accountid, (m0 - interval '3 months')::date - 1);
      perform pg_temp.rec('11 dev followed card ' || r.goal_name || ': pace from month-end balances',
        case when v_drop > 0 then 'pace|' || round(v_drop / 3, 2)::text else 'no_pace|null' end,
        split_part(pg_temp.pace_of(r.id), '|', 1) || '|' || split_part(pg_temp.pace_of(r.id), '|', 2));
    end if;
  end loop;
  perform pg_temp.unbecome();
end
$$;

-- The summary is the LAST row. A run counts as passed only when it says
-- ALL PASS (CLAUDE.md): every row true AND all 12 fixture checks present
-- (section 11's dev rows vary by project, so they're counted but not
-- required). A run that errors part-way returns no rows at all.
with tally as (
  select count(*)                                    as total,
         count(*) filter (where not pass)            as failed,
         count(*) filter (where check_ !~ '^11 ')    as fixture_rows
    from gp_results
)
select check_ as check, expected, actual, pass
  from (select seq, check_, expected, actual, pass
          from gp_results
        union all
        select 2147483647, 'SUMMARY', 'ALL PASS (12 fixture checks, 0 false)',
               t.total || ' rows (' || t.fixture_rows || ' of 12 fixture checks), ' || t.failed || ' false -- '
                 || case when t.failed = 0 and t.fixture_rows = 12 then 'ALL PASS' else 'NOT PASSED' end,
               t.failed = 0 and t.fixture_rows = 12
          from tally t) x
 order by seq;

rollback;
