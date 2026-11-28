-- =====================================================================
-- Several schedules feed one goal (migration 82; docs/Goals-and-Import.md
-- Part A and "Rulings after Phase 1", 2026-11-28)
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/goal-multi-schedule-test.sql
--
-- It writes, then rolls back, so it isn't --read-only and the CLI asks
-- for confirmation: Matt runs it. Every check runs AS the user -- role
-- authenticated, request.jwt.claims set, as PostgREST does -- except where
-- a check says it runs as the table owner (to reach the FK past RLS).
-- Self-cleaning: two throwaway users, one transaction, ROLLBACK. Cleanup
-- check (must be 0):
--   select count(*) from auth.users where email like 'gms-test-%@example.invalid';
--
--   1  Two schedules linked to one goal: both carry it.
--   2  Linking a third never unlinks the first two.
--   3  Moving a schedule to another goal moves that schedule only.
--   4  A confirmed occurrence (both legs inserted with the recurringid,
--      as confirmOccurrence does) auto-links: the Expense leg carries the
--      schedule's goal, the Income leg none; it's goal money this month,
--      once (one row per transfer, not per leg).
--   5  A schedule paused mid-month: it leaves v_upcoming_recurring, and
--      its confirmed occurrence stays this month's goal money -- so the
--      hold can't take that money again (the netting itself is TS, 6).
--   6  The hold's inputs: a goal its schedules fund is no longer dropped
--      (it holds what they don't cover). The NETTING -- weekly $50 against
--      a $400 target holds $150; an occurrence after the horizon isn't
--      netted; an ended schedule mid-month nets only what's left -- runs
--      in the projection, from its own obligations, and is pinned by
--      lib/safeToSpendProjection.test.ts ("netted hold: ...", "an
--      occurrence after the projection's horizon isn't netted ...",
--      "a schedule that ends mid-month ..."). SQL can't see that set.
--   7  Changing one occurrence's goal (update_transfer) leaves the
--      schedule's link alone.
--   8  Earlier confirmations: link_earlier_occurrences counts them on
--      request -- Expense legs only, returned for the same-money question.
--   9  Deleting a goal leaves its schedules running and unlinked; their
--      confirmed transfers stay, unlinked too.
--  10  Another user's goal is refused: by set_goal_funding (RLS) and, as
--      the table owner, by the composite FK.
--  11  A goal that follows a card: no schedule can feed it, and a goal
--      that schedules feed can't start following a card.
--  12  Only a transfer schedule can feed a goal.
--  13  The push window: the previous deploy's write of
--      goals.funding_recurringid reaches the schedule (mirror trigger).
-- =====================================================================

begin;

create temp table gms_results (
  seq      serial primary key,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
grant insert, select on gms_results to authenticated;
grant usage on sequence gms_results_seq_seq to authenticated;

create function pg_temp.rec(p_check text, p_expected text, p_actual text) returns void
language sql as $$
  insert into gms_results (check_, expected, actual, pass)
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

-- Each schedule's goal as "description=goal name", in description order.
create function pg_temp.links(p_user uuid) returns text language sql as $$
  select string_agg(r.description || '=' || coalesce(g.goal_name, '-'), ', ' order by r.description)
    from public.recurring_transactions r
    left join public.goals g on g.id = r.goalid
   where r.userid = p_user
     and r.to_accountid is not null
$$;

insert into auth.users (id, instance_id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('9b000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'gms-test-a@example.invalid', '{}'::jsonb,
        '{"first_name": "Gms", "last_name": "Test"}'::jsonb, now(), now()),
       ('9b000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'gms-test-b@example.invalid', '{}'::jsonb,
        '{"first_name": "Gms", "last_name": "Other"}'::jsonb, now(), now());

do $$
declare
  u        constant uuid := '9b000000-0000-4000-8000-000000000001';
  other    constant uuid := '9b000000-0000-4000-8000-000000000002';
  chk      constant uuid := '9b000000-0000-4000-8000-000000000011';
  sav      constant uuid := '9b000000-0000-4000-8000-000000000012';
  visa     constant uuid := '9b000000-0000-4000-8000-000000000013';
  o_chk    constant uuid := '9b000000-0000-4000-8000-000000000014';
  weekly   constant uuid := '9b000000-0000-4000-8000-000000000021';
  monthly  constant uuid := '9b000000-0000-4000-8000-000000000022';
  third    constant uuid := '9b000000-0000-4000-8000-000000000023';
  old_app  constant uuid := '9b000000-0000-4000-8000-000000000024';
  rent     constant uuid := '9b000000-0000-4000-8000-000000000025';
  g_trip   constant uuid := '9b000000-0000-4000-8000-000000000031';
  g_beach  constant uuid := '9b000000-0000-4000-8000-000000000032';
  g_card   constant uuid := '9b000000-0000-4000-8000-000000000033';
  g_other  constant uuid := '9b000000-0000-4000-8000-000000000034';
  grp_now  constant uuid := '9b000000-0000-4000-8000-0000000000a1';
  grp_old  constant uuid := '9b000000-0000-4000-8000-0000000000a2';
  exp_now  uuid;
  inc_now  uuid;
  cat      uuid;
  v_text   text;
  v_n      bigint;
  v_ids    uuid[];
  v_goal   uuid;
begin
  -- Fixtures ----------------------------------------------------------
  perform pg_temp.become(u);
  select id into cat from public.categories where userid = u and category_type = 'Expense' order by category_name limit 1;

  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (chk,  u, 'GMS checking', 'Checking',    5000, current_date - 60),
         (sav,  u, 'GMS savings',  'Savings',     0,    current_date - 60),
         (visa, u, 'GMS Visa',     'Credit Card', -800, current_date - 60);

  insert into public.goals (id, userid, goal_name, goal_type, target_amount, monthly_contribution)
  values (g_trip,  u, 'Trip',  'Vacation',    5000, 400),
         (g_beach, u, 'Beach', 'Vacation',    2000, null),
         (g_card,  u, 'Card',  'Debt Payoff', 800,  null);

  insert into public.recurring_transactions
    (id, userid, accountid, to_accountid, description, amount, frequency,
     next_run_date, start_date, next_due_date)
  values (weekly,  u, chk, sav, 'A weekly',  50,  'Weekly',  current_date + 1, current_date + 1, current_date + 1),
         (monthly, u, chk, sav, 'B monthly', 200, 'Monthly', current_date + 2, current_date + 2, current_date + 2),
         (third,   u, chk, sav, 'C third',   25,  'Monthly', current_date + 3, current_date + 3, current_date + 3),
         (old_app, u, chk, sav, 'D old app', 10,  'Monthly', current_date + 4, current_date + 4, current_date + 4);
  insert into public.recurring_transactions
    (id, userid, accountid, categoryid, description, amount, frequency,
     next_run_date, start_date, next_due_date)
  values (rent, u, chk, cat, 'E rent', 900, 'Monthly', current_date + 5, current_date + 5, current_date + 5);

  -- 8's earlier confirmation: confirmed BEFORE the schedule fed a goal,
  -- so nothing linked it.
  insert into public.transactions
    (userid, accountid, amount, transaction_type, transaction_date, description, recurringid, transfer_group_id)
  values (u, chk, 50, 'Expense', current_date - 7, 'A weekly', weekly, grp_old),
         (u, sav, 50, 'Income',  current_date - 7, 'A weekly', weekly, grp_old);

  -- 1 -----------------------------------------------------------------
  perform public.set_goal_funding(weekly, g_trip);
  perform public.set_goal_funding(monthly, g_trip);
  perform pg_temp.rec('1 two schedules feed one goal',
    'A weekly=Trip, B monthly=Trip, C third=-, D old app=-', pg_temp.links(u));

  -- 2 -----------------------------------------------------------------
  perform public.set_goal_funding(third, g_trip);
  perform pg_temp.rec('2 linking a third unlinks nothing',
    'A weekly=Trip, B monthly=Trip, C third=Trip, D old app=-', pg_temp.links(u));

  -- 3 -----------------------------------------------------------------
  perform public.set_goal_funding(third, g_beach);
  perform pg_temp.rec('3 moving one schedule moves that one only',
    'A weekly=Trip, B monthly=Trip, C third=Beach, D old app=-', pg_temp.links(u));
  perform pg_temp.rec('3b no goal row was written by linking (the link is the schedule''s)',
    '0', (select count(*)::text from public.goals where userid = u and funding_recurringid is not null));

  -- 4 -----------------------------------------------------------------
  -- What confirmOccurrence inserts for "It landed": both legs, one group,
  -- the schedule's recurringid, no goal named.
  insert into public.transactions
    (userid, accountid, amount, transaction_type, transaction_date, description, recurringid, transfer_group_id)
  values (u, chk, 50, 'Expense', current_date, 'A weekly', weekly, grp_now),
         (u, sav, 50, 'Income',  current_date, 'A weekly', weekly, grp_now);
  select id into exp_now from public.transactions where transfer_group_id = grp_now and transaction_type = 'Expense';
  select id into inc_now from public.transactions where transfer_group_id = grp_now and transaction_type = 'Income';
  perform pg_temp.rec('4 a confirmed occurrence auto-links: Expense leg Trip, Income leg none',
    'Trip|-',
    (select coalesce(g.goal_name, '-') from public.transactions t left join public.goals g on g.id = t.goalid where t.id = exp_now)
      || '|' ||
    (select coalesce(g.goal_name, '-') from public.transactions t left join public.goals g on g.id = t.goalid where t.id = inc_now));
  perform pg_temp.rec('4b the transfer is goal money once, not once per leg',
    '1', (select count(*)::text from public.v_goal_money where goalid = g_trip and transaction_id in (exp_now, inc_now)));
  perform pg_temp.rec('4c it is this month''s goal money for the hold',
    '50.00', (select contributed_this_month::numeric(12,2)::text from public.v_goal_hold_inputs where goalid = g_trip));
  insert into public.transactions
    (userid, accountid, amount, transaction_type, transaction_date, description, recurringid, transfer_group_id, goalid)
  values (u, chk, 50, 'Expense', current_date, 'A weekly', weekly, gen_random_uuid(), g_beach)
  returning goalid into v_goal;
  perform pg_temp.rec('4d an occurrence naming its own goal keeps it',
    'Beach', (select goal_name from public.goals where id = v_goal));
  delete from public.transactions where recurringid = weekly and goalid = g_beach and transaction_date = current_date;
  v_ids := null;

  -- 5 -----------------------------------------------------------------
  update public.recurring_transactions set is_active = false where id = weekly;
  perform pg_temp.rec('5 paused mid-month: it leaves v_upcoming_recurring',
    '0', (select count(*)::text from public.v_upcoming_recurring where recurring_id = weekly));
  perform pg_temp.rec('5b ... and its confirmed occurrence stays this month''s goal money',
    '50.00', (select contributed_this_month::numeric(12,2)::text from public.v_goal_hold_inputs where goalid = g_trip));
  update public.recurring_transactions set is_active = true where id = weekly;

  -- 6 -----------------------------------------------------------------
  perform pg_temp.rec('6 a goal its schedules fund is still a hold input: target, money in, left',
    '400.00|50.00|4950.00',
    (select monthly_contribution::numeric(12,2)::text || '|' || contributed_this_month::numeric(12,2)::text
            || '|' || remaining_to_target::numeric(12,2)::text
       from public.v_goal_hold_inputs where goalid = g_trip));
  perform pg_temp.rec('6b the previous deploy''s view still switches the hold off for a funded goal',
    '0', (select count(*)::text from public.v_goal_monthly_holds where goalid = g_trip));

  -- 7 -----------------------------------------------------------------
  perform public.update_transfer(
    p_transfer_group_id => grp_now, p_from_accountid => chk, p_to_accountid => sav,
    p_amount => 50, p_transaction_date => current_date, p_description => 'A weekly',
    p_set_goal => true, p_goalid => g_beach);
  perform pg_temp.rec('7 one occurrence moved to Beach; the schedule still feeds Trip',
    'Beach|Trip',
    (select g.goal_name from public.transactions t join public.goals g on g.id = t.goalid where t.id = exp_now)
      || '|' ||
    (select g.goal_name from public.recurring_transactions r join public.goals g on g.id = r.goalid where r.id = weekly));

  -- 8 -----------------------------------------------------------------
  select array_agg(transaction_id) into v_ids from public.link_earlier_occurrences(weekly);
  perform pg_temp.rec('8 earlier confirmations counted on request: the one Expense leg',
    '1|Trip|-',
    coalesce(array_length(v_ids, 1), 0)::text || '|' ||
    (select coalesce(g.goal_name, '-') from public.transactions t left join public.goals g on g.id = t.goalid
      where t.transfer_group_id = grp_old and t.transaction_type = 'Expense') || '|' ||
    (select coalesce(g.goal_name, '-') from public.transactions t left join public.goals g on g.id = t.goalid
      where t.transfer_group_id = grp_old and t.transaction_type = 'Income'));
  perform pg_temp.rec('8b it never moves a leg already for another goal (7''s, on Beach)',
    'Beach', (select g.goal_name from public.transactions t join public.goals g on g.id = t.goalid where t.id = exp_now));

  -- 11 ----------------------------------------------------------------
  perform public.link_goal_to_card(g_card, visa);
  begin
    perform public.set_goal_funding(old_app, g_card);
    perform pg_temp.rec('11 a schedule can''t feed a goal that follows a card', 'refused (23514)', 'linked');
  exception when sqlstate '23514' then
    perform pg_temp.rec('11 a schedule can''t feed a goal that follows a card', 'refused (23514)', 'refused (23514)');
  end;
  perform public.unlink_goal_from_card(g_card);
  perform public.set_goal_funding(old_app, g_card);
  begin
    perform public.link_goal_to_card(g_card, visa);
    perform pg_temp.rec('11b a goal schedules feed can''t start following a card', 'refused (23514)', 'followed');
  exception when sqlstate '23514' then
    perform pg_temp.rec('11b a goal schedules feed can''t start following a card', 'refused (23514)', 'refused (23514)');
  end;
  perform public.set_goal_funding(old_app, null);

  -- 12 ----------------------------------------------------------------
  begin
    perform public.set_goal_funding(rent, g_trip);
    perform pg_temp.rec('12 an expense schedule can''t feed a goal', 'refused (P0002)', 'linked');
  exception when sqlstate 'P0002' then
    perform pg_temp.rec('12 an expense schedule can''t feed a goal', 'refused (P0002)', 'refused (P0002)');
  end;

  -- 13 ----------------------------------------------------------------
  -- The previous deploy's goal form: write the goal's one slot.
  update public.goals set funding_recurringid = old_app where id = g_beach;
  perform pg_temp.rec('13 the old app''s write reaches the schedule',
    'Beach', (select g.goal_name from public.recurring_transactions r join public.goals g on g.id = r.goalid where r.id = old_app));
  update public.goals set funding_recurringid = null where id = g_beach;
  perform pg_temp.rec('13b ... and clearing it there unlinks that schedule only',
    'A weekly=Trip, B monthly=Trip, C third=Beach, D old app=-', pg_temp.links(u));

  -- 9 -----------------------------------------------------------------
  delete from public.goals where id = g_trip;
  perform pg_temp.rec('9 deleting a goal: its schedules keep running, unlinked',
    'A weekly=-|true, B monthly=-|true',
    (select string_agg(r.description || '=' || coalesce(r.goalid::text, '-') || '|' || r.is_active::text, ', ' order by r.description)
       from public.recurring_transactions r where r.id in (weekly, monthly)));
  perform pg_temp.rec('9b ... and its confirmed transfer stays, unlinked',
    '2|0', (select count(*)::text || '|' || count(goalid)::text from public.transactions where transfer_group_id = grp_old));
  perform pg_temp.unbecome();

  -- 10 ----------------------------------------------------------------
  perform pg_temp.become(other);
  insert into public.goals (id, userid, goal_name, goal_type, target_amount)
  values (g_other, other, 'Theirs', 'Custom', 100);
  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (o_chk, other, 'Their checking', 'Checking', 100, current_date - 60);
  perform pg_temp.unbecome();

  perform pg_temp.become(u);
  begin
    perform public.set_goal_funding(monthly, g_other);
    perform pg_temp.rec('10 set_goal_funding refuses another user''s goal', 'refused (P0002)', 'linked');
  exception when sqlstate 'P0002' then
    perform pg_temp.rec('10 set_goal_funding refuses another user''s goal', 'refused (P0002)', 'refused (P0002)');
  end;
  perform pg_temp.unbecome();

  -- As the table owner: RLS bypassed, so only the composite FK can refuse it.
  begin
    update public.recurring_transactions set goalid = g_other where id = monthly;
    perform pg_temp.rec('10b the composite FK refuses another user''s goal', 'refused (23503)', 'linked');
  exception when foreign_key_violation then
    perform pg_temp.rec('10b the composite FK refuses another user''s goal', 'refused (23503)', 'refused (23503)');
  end;

  perform pg_temp.become(other);
  select count(*) into v_n from public.recurring_transactions where userid = u;
  perform pg_temp.unbecome();
  perform pg_temp.rec('10c the other user sees none of these schedules', '0', v_n::text);
end
$$;

-- The summary is the LAST row. A run counts as passed only when it says
-- ALL PASS (CLAUDE.md): every row true AND all 25 checks present. A run
-- that errors part-way returns no rows at all.
with tally as (
  select count(*) as total, count(*) filter (where not pass) as failed from gms_results
)
select check_ as check, expected, actual, pass
  from (select seq, check_, expected, actual, pass
          from gms_results
        union all
        select 2147483647, 'SUMMARY', 'ALL PASS (25 checks, 0 false)',
               t.total || ' rows, ' || t.failed || ' false -- '
                 || case when t.failed = 0 and t.total = 25 then 'ALL PASS' else 'NOT PASSED' end,
               t.failed = 0 and t.total = 25
          from tally t) x
 order by seq;

rollback;
