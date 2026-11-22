-- =====================================================================
-- Recurring "Ends" test (migration 79)
--
-- Run it through the runner, never directly:
--
--   npm run test:parity:ends
--   npm run test:parity:ends -- --with supabase/migrations/<file>.sql
--
-- scripts/recurring-ends-parity.ts evaluates the TypeScript rule
-- (lib/recurringEnds.ts) over a grid of cases and NON_BUSINESS_DAY_RULES
-- (lib/businessDays.ts), pastes them into the __TS_ENDS_RULE__ marker
-- below, and runs this file against sorrel-dev by ref. The comparison
-- happens here, in the P rows, so the CLI's own text output -- with its
-- confirmation prompt -- is the whole result. Run directly, the marker is
-- not valid JSON and the file errors at once rather than passing on
-- nothing.
--
-- It writes, then rolls back, so it isn't --read-only and the CLI asks
-- for confirmation: Matt runs it. Self-cleaning: one throwaway user, one
-- transaction, ROLLBACK. Cleanup check (must be 0):
--   select count(*) from auth.users where email like 'ends-test-%@example.invalid';
--
-- A run passes only when its last row, SUMMARY, says ALL PASS.
--
-- The rule (rulings 2026-11-22; recurring_is_finished(), migration 79):
--   * an occurrence belongs when its SCHEDULED date (next_run_date) is on
--     or before end_date and fewer than occurrence_limit are done;
--   * done = linked occurrences. "Not happening" never counts; deleting a
--     confirmed transaction brings its occurrence back;
--   * finished is derived: raising N or extending the date revives it;
--   * an occurrence on or before end_date stays until answered.
--
-- Advance paths, each driven the way the app drives it:
--   landed     confirmOccurrence() (lib/db/recurring.ts): cursor +1 cycle,
--              then the linked row(s). TypeScript, emulated statement for
--              statement (both legs for a transfer).
--   skipped    skipOccurrence(): cursor +1 cycle, nothing written.
--   make-rec   link_transaction_to_schedule() (60) -- the real call.
--   same-bill  confirm_same_bill() (66) -- the real call.
--   import     import_transactions() with a same_bill answer (68/76).
--
-- Consumers read: v_upcoming_recurring (the queue, projection, Coming up,
-- Upcoming, runway, same bill, next payday, statement prompt and goal
-- funding picker all start from it), v_recurring_state (the Recurring
-- page's Ended section) and v_goal_monthly_holds.
--
-- Also in migration 79: renaming an ended schedule saves (C1), and
-- non_business_day_rule takes exactly none / before / after (R1) -- the
-- form's "earlier" / "later" timing used to be refused by a second,
-- contradictory CHECK.
--
-- Parity with the TypeScript rule:
--   P1  every TS case, recomputed by recurring_is_finished() and
--       recurring_occurrences_remaining() on the same inputs.
--   P2  every 'state' row (each scenario's end fields after its
--       answers, and the R cases) against the TS answer for its inputs:
--       the order of next_run_date and end_date, the limit, and the
--       occurrences done.
--   R1  the timing rules the database saves = NON_BUSINESS_DAY_RULES.
-- =====================================================================

begin;

create temp table er (
  seq              serial primary key,
  scenario         text not null,
  consumer         text not null,
  expected         text not null,
  actual           text not null,
  pass             boolean not null,
  next_run_date    date,
  end_date         date,
  occurrence_limit integer,
  occurrences_done bigint,
  sql_finished     boolean,
  sql_remaining    bigint
);
grant insert, select on er to authenticated;
grant usage on sequence er_seq_seq to authenticated;

-- What the TS side said. Shape:
--   { "cases": [ { "rel": -1 | 0 | 1 | null,  -- sign(next_run_date - end_date); null: no end date
--                  "lim": n | null, "done": n,
--                  "finished": bool, "remaining": n | null }, ... ],
--     "rules": [...NON_BUSINESS_DAY_RULES] }
create temp table ends_ts as
select $ts$__TS_ENDS_RULE__$ts$::jsonb as payload;
grant select on ends_ts to authenticated;

create function pg_temp.rec(p_scen text, p_cons text, p_expected text, p_actual text)
returns void language sql as $$
  insert into er (scenario, consumer, expected, actual, pass)
  values (p_scen, p_cons, p_expected, coalesce(p_actual, '<null>'), coalesce(p_expected = p_actual, false))
$$;

-- v_upcoming_recurring's answer, in the form the rows compare.
create function pg_temp.vstate(p_s uuid) returns text language sql as $$
  select coalesce(
    (select 'shown, due ' || next_due_date
            || coalesce(', remaining ' || occurrences_remaining, '')
       from public.v_upcoming_recurring where recurring_id = p_s),
    'not shown')
$$;

-- What the Recurring page renders (page.tsx + RecurringRow).
create function pg_temp.pstate(p_s uuid) returns text language sql as $$
  select case
           when st.is_finished then 'Ended'
           when r.is_active then 'listed, Due ' || r.next_due_date
           else 'paused'
         end
    from public.recurring_transactions r
    join public.v_recurring_state st on st.recurring_id = r.id
   where r.id = p_s
$$;

-- The schedule's state for the parity runner, with the ruling's answer.
create function pg_temp.snap(p_scen text, p_s uuid, p_finished boolean) returns void language sql as $$
  insert into er (scenario, consumer, expected, actual, pass,
                  next_run_date, end_date, occurrence_limit, occurrences_done, sql_finished, sql_remaining)
  select p_scen, 'state', case when p_finished then 'finished' else 'open' end,
         case when st.is_finished then 'finished' else 'open' end,
         st.is_finished = p_finished,
         r.next_run_date, r.end_date, r.occurrence_limit, st.occurrences_done, st.is_finished, st.occurrences_remaining
    from public.recurring_transactions r
    join public.v_recurring_state st on st.recurring_id = r.id
   where r.id = p_s
$$;

-- confirmOccurrence() as the app does it: claim (cursor +1 month), then the linked row(s).
create function pg_temp.landed(p_s uuid) returns void language plpgsql as $$
declare
  r   public.recurring_transactions%rowtype;
  grp uuid := gen_random_uuid();
  ctype text;
begin
  select * into r from public.recurring_transactions where id = p_s;
  update public.recurring_transactions
     set next_run_date = (r.next_run_date + interval '1 month')::date,
         next_due_date = (r.next_run_date + interval '1 month')::date
   where id = p_s and next_run_date = r.next_run_date;
  if r.to_accountid is not null then
    insert into public.transactions (userid, accountid, categoryid, amount, transaction_type,
                                     transaction_date, description, recurringid, transfer_group_id, is_estimated)
    values (r.userid, r.accountid,    null, r.amount, 'Expense', r.next_due_date, r.description, p_s, grp, false),
           (r.userid, r.to_accountid, null, r.amount, 'Income',  r.next_due_date, r.description, p_s, grp, false);
  else
    select category_type into ctype from public.categories where id = r.categoryid;
    insert into public.transactions (userid, accountid, categoryid, amount, transaction_type,
                                     transaction_date, description, recurringid, is_estimated)
    values (r.userid, r.accountid, r.categoryid, r.amount, ctype, r.next_due_date, r.description, p_s, false);
  end if;
end $$;

-- skipOccurrence(): cursor +1 month, nothing written.
create function pg_temp.skipped(p_s uuid) returns void language plpgsql as $$
begin
  update public.recurring_transactions
     set next_run_date = (next_run_date + interval '1 month')::date,
         next_due_date = (next_run_date + interval '1 month')::date
   where id = p_s;
end $$;

create function pg_temp.sched(p_u uuid, p_acct uuid, p_cat uuid, p_name text, p_next date,
                              p_limit integer, p_end date, p_start date default null)
returns uuid language plpgsql as $$
declare s uuid := gen_random_uuid();
begin
  insert into public.recurring_transactions (id, userid, accountid, categoryid, description, amount,
    frequency, next_run_date, start_date, next_due_date, occurrence_limit, end_date)
  values (s, p_u, p_acct, p_cat, p_name, 100, 'Monthly', p_next, coalesce(p_start, p_next), p_next, p_limit, p_end);
  return s;
end $$;

create function pg_temp.become(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

insert into auth.users (id, instance_id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'ends-test-e@example.invalid', '{}'::jsonb,
        '{"first_name": "Ends", "last_name": "Test"}'::jsonb, now(), now());

do $$
declare
  u    constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  chk  constant uuid := 'eeeeeeee-0000-4000-8000-000000000001';
  sav  constant uuid := 'eeeeeeee-0000-4000-8000-000000000002';
  gl   constant uuid := 'eeeeeeee-0000-4000-8000-000000000003';
  t    constant date := current_date;
  m1   constant interval := interval '1 month';
  rent uuid;
  s    uuid;
  tx   uuid;
  res  text;
  sat  date;
begin
  select id into rent from public.categories where userid = u and category_name = 'Rent';
  perform pg_temp.become(u);

  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (chk, u, 'ZZ ends checking', 'Checking', 5000, t - 200),
         (sav, u, 'ZZ ends savings',  'Savings',  0,    t - 200);

  -- ================================================================ After 1
  -- A1 It landed; then deleted; then landed again; then N raised
  s := pg_temp.sched(u, chk, rent, 'A1 landed', t - 5, 1, null);
  perform pg_temp.landed(s);
  perform pg_temp.rec('A1 After 1, It landed', 'v_upcoming_recurring', 'not shown', pg_temp.vstate(s));
  perform pg_temp.rec('A1 After 1, It landed', 'Recurring page', 'Ended', pg_temp.pstate(s));
  perform pg_temp.snap('A1 After 1, It landed', s, true);

  delete from public.transactions where recurringid = s;
  perform pg_temp.rec('A1 ... its transaction deleted: the occurrence is back', 'v_upcoming_recurring',
    'shown, due ' || (t - 5 + m1)::date || ', remaining 1', pg_temp.vstate(s));
  perform pg_temp.rec('A1 ... its transaction deleted', 'Recurring page',
    'listed, Due ' || (t - 5 + m1)::date, pg_temp.pstate(s));
  perform pg_temp.snap('A1 ... its transaction deleted', s, false);

  perform pg_temp.landed(s);
  update public.recurring_transactions set occurrence_limit = 2 where id = s;
  perform pg_temp.rec('A1 ... landed again, then N raised to 2: revived', 'v_upcoming_recurring',
    'shown, due ' || ((t - 5 + m1)::date + m1)::date || ', remaining 1', pg_temp.vstate(s));
  perform pg_temp.rec('A1 ... N raised to 2', 'Recurring page',
    'listed, Due ' || ((t - 5 + m1)::date + m1)::date, pg_temp.pstate(s));
  perform pg_temp.snap('A1 ... N raised to 2', s, false);

  -- A2 Not happening: doesn't count
  s := pg_temp.sched(u, chk, rent, 'A2 skipped', t - 5, 1, null);
  perform pg_temp.skipped(s);
  perform pg_temp.rec('A2 After 1, Not happening: still open', 'v_upcoming_recurring',
    'shown, due ' || (t - 5 + m1)::date || ', remaining 1', pg_temp.vstate(s));
  perform pg_temp.snap('A2 After 1, Not happening', s, false);

  -- A3 Make recurring from a past transaction (the source is occurrence 1)
  tx := gen_random_uuid();
  insert into public.transactions (id, userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description)
  values (tx, u, chk, rent, 100, 'Expense', t - 5, 'A3 make recurring');
  s := pg_temp.sched(u, chk, rent, 'A3 make recurring', (t - 5 + m1)::date, 1, null, t - 5);
  perform pg_temp.rec('A3 After 1, Make recurring', 'link_transaction_to_schedule', 'true',
    public.link_transaction_to_schedule(tx, s)::text);
  perform pg_temp.rec('A3 After 1, Make recurring', 'v_upcoming_recurring', 'not shown', pg_temp.vstate(s));
  perform pg_temp.rec('A3 After 1, Make recurring', 'Recurring page', 'Ended', pg_temp.pstate(s));
  perform pg_temp.snap('A3 After 1, Make recurring', s, true);

  -- A4 Same bill Yes (an entry dated ahead)
  s := pg_temp.sched(u, chk, rent, 'A4 same bill', t + 10, 1, null);
  tx := gen_random_uuid();
  insert into public.transactions (id, userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description)
  values (tx, u, chk, rent, 100, 'Expense', t + 10, 'A4 same bill');
  res := public.confirm_same_bill(tx, s, t + 10, (t + 10 + m1)::date, (t + 10 + m1)::date);
  perform pg_temp.rec('A4 After 1, same bill Yes', 'confirm_same_bill', 'answered', res);
  perform pg_temp.rec('A4 After 1, same bill Yes', 'v_upcoming_recurring', 'not shown', pg_temp.vstate(s));
  perform pg_temp.rec('A4 After 1, same bill Yes', 'Recurring page', 'Ended', pg_temp.pstate(s));
  perform pg_temp.snap('A4 After 1, same bill Yes', s, true);

  -- A5 Import with a same-bill answer
  s := pg_temp.sched(u, chk, rent, 'A5 import', t - 3, 1, null);
  perform 1 from public.import_transactions(chk, jsonb_build_array(jsonb_build_object(
    'row', 1, 'date', (t - 3)::text, 'cents', 10000, 'type', 'Expense',
    'description', 'A5 import', 'categoryid', rent,
    'same_bill', jsonb_build_object('recurringid', s, 'from_run_date', (t - 3)::text,
      'to_run_date', (t - 3 + m1)::date::text, 'to_due_date', (t - 3 + m1)::date::text))));
  perform pg_temp.rec('A5 After 1, import same bill', 'linked rows', '1',
    (select count(*)::text from public.transactions where recurringid = s));
  perform pg_temp.rec('A5 After 1, import same bill', 'v_upcoming_recurring', 'not shown', pg_temp.vstate(s));
  perform pg_temp.rec('A5 After 1, import same bill', 'Recurring page', 'Ended', pg_temp.pstate(s));
  perform pg_temp.snap('A5 After 1, import same bill', s, true);

  -- ================================================================ After 3
  -- B1 three It landed
  s := pg_temp.sched(u, chk, rent, 'B1 landed x3', t - 65, 3, null);
  perform pg_temp.landed(s);
  perform pg_temp.landed(s);
  perform pg_temp.rec('B1 After 3, landed x2', 'v_upcoming_recurring',
    'shown, due ' || ((t - 65 + m1)::date + m1)::date || ', remaining 1', pg_temp.vstate(s));
  perform pg_temp.snap('B1 After 3, landed x2', s, false);
  perform pg_temp.landed(s);
  perform pg_temp.rec('B1 After 3, landed x3', 'v_upcoming_recurring', 'not shown', pg_temp.vstate(s));
  perform pg_temp.rec('B1 After 3, landed x3', 'Recurring page', 'Ended', pg_temp.pstate(s));
  perform pg_temp.snap('B1 After 3, landed x3', s, true);

  -- B2 landed, skipped, landed: two done, one to go
  s := pg_temp.sched(u, chk, rent, 'B2 landed/skip/landed', t - 65, 3, null);
  perform pg_temp.landed(s);
  perform pg_temp.skipped(s);
  perform pg_temp.landed(s);
  perform pg_temp.rec('B2 After 3, landed/skipped/landed', 'v_upcoming_recurring',
    'shown, due ' || (((t - 65 + m1)::date + m1)::date + m1)::date || ', remaining 1', pg_temp.vstate(s));
  perform pg_temp.snap('B2 After 3, landed/skipped/landed', s, false);

  -- B3 every counting path once: make-recurring source, landed, same bill
  tx := gen_random_uuid();
  insert into public.transactions (id, userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description)
  values (tx, u, chk, rent, 100, 'Expense', t - 35, 'B3 mixed');
  s := pg_temp.sched(u, chk, rent, 'B3 mixed', t - 5, 3, null, t - 35);
  perform public.link_transaction_to_schedule(tx, s);
  perform pg_temp.landed(s);
  tx := gen_random_uuid();
  insert into public.transactions (id, userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description)
  values (tx, u, chk, rent, 100, 'Expense', (t - 5 + m1)::date, 'B3 mixed');
  res := public.confirm_same_bill(tx, s, (t - 5 + m1)::date,
    ((t - 5 + m1)::date + m1)::date, ((t - 5 + m1)::date + m1)::date);
  perform pg_temp.rec('B3 After 3, source + landed + same bill', 'confirm_same_bill', 'answered', res);
  perform pg_temp.rec('B3 After 3, source + landed + same bill', 'v_upcoming_recurring', 'not shown', pg_temp.vstate(s));
  perform pg_temp.rec('B3 After 3, source + landed + same bill', 'Recurring page', 'Ended', pg_temp.pstate(s));
  perform pg_temp.snap('B3 After 3, source + landed + same bill', s, true);

  -- ================================================================ On date
  -- C1 end in 5 days; two cycles landed, the next is after the end
  s := pg_temp.sched(u, chk, rent, 'C1 on date', t - 35, null, t + 5);
  perform pg_temp.landed(s);
  perform pg_temp.rec('C1 On date (t+5), landed x1', 'v_upcoming_recurring',
    'shown, due ' || (t - 35 + m1)::date, pg_temp.vstate(s));
  perform pg_temp.snap('C1 On date (t+5), landed x1', s, false);
  perform pg_temp.landed(s);
  perform pg_temp.rec('C1 On date (t+5), landed x2 -- next cycle is after the end', 'v_upcoming_recurring',
    'not shown', pg_temp.vstate(s));
  perform pg_temp.rec('C1 On date (t+5), landed x2', 'Recurring page', 'Ended', pg_temp.pstate(s));
  perform pg_temp.snap('C1 On date (t+5), landed x2', s, true);
  -- Renaming an ended schedule saves (the form's order check runs only
  -- when a date changes -- endDateOrderError, lib/recurringEnds.ts; the
  -- database never refused it), and it stays Ended.
  update public.recurring_transactions set description = 'C1 renamed' where id = s;
  perform pg_temp.rec('C1 ... renamed while Ended', 'recurring_transactions',
    'C1 renamed, Ended', (select description from public.recurring_transactions where id = s) || ', ' || pg_temp.pstate(s));
  update public.recurring_transactions set end_date = t + 60 where id = s;
  perform pg_temp.rec('C1 ... end date moved to t+60: revived', 'v_upcoming_recurring',
    'shown, due ' || ((t - 35 + m1)::date + m1)::date, pg_temp.vstate(s));
  perform pg_temp.snap('C1 ... end date moved to t+60', s, false);

  -- C2 inclusive: the next occurrence falls ON the end date
  s := pg_temp.sched(u, chk, rent, 'C2 inclusive', t + 10, null, t + 10);
  perform pg_temp.rec('C2 On date = next occurrence', 'v_upcoming_recurring',
    'shown, due ' || (t + 10), pg_temp.vstate(s));
  perform pg_temp.snap('C2 On date = next occurrence', s, false);

  -- C3 the last occurrence before the end date, unanswered, end date passed
  s := pg_temp.sched(u, chk, rent, 'C3 unanswered', t - 5, null, t - 1, t - 35);
  perform pg_temp.rec('C3 On date (t-1), occurrence t-5 never answered: stays', 'v_upcoming_recurring',
    'shown, due ' || (t - 5), pg_temp.vstate(s));
  perform pg_temp.rec('C3 On date (t-1), occurrence t-5 never answered', 'Recurring page',
    'listed, Due ' || (t - 5), pg_temp.pstate(s));
  perform pg_temp.snap('C3 On date (t-1), never answered', s, false);
  perform pg_temp.landed(s);
  perform pg_temp.rec('C3 ... then answered: ended', 'v_upcoming_recurring', 'not shown', pg_temp.vstate(s));
  perform pg_temp.snap('C3 ... then answered', s, true);

  -- C4 the same with After 1 (control)
  s := pg_temp.sched(u, chk, rent, 'C4 control', t - 40, 1, null);
  perform pg_temp.rec('C4 After 1, occurrence t-40 never answered (control)', 'v_upcoming_recurring',
    'shown, due ' || (t - 40) || ', remaining 1', pg_temp.vstate(s));
  perform pg_temp.snap('C4 After 1, never answered', s, false);

  -- ================================================================ Business-day edge
  -- D1 scheduled ON the end date (a Saturday), posting a business day
  -- later: inclusion is the scheduled date, so it's in. next_due_date is
  -- set as the app computes it (resolve_recurring_due_date). The rules
  -- themselves are R1 below.
  sat := t + 7 + ((6 - extract(dow from t + 7)::int + 7) % 7);
  s := pg_temp.sched(u, chk, rent, 'D1 business day', sat, null, sat);
  update public.recurring_transactions
     set business_day_offset = 1,
         next_due_date = public.resolve_recurring_due_date(sat, 1, 'none')
   where id = s;
  perform pg_temp.rec('D1 posting moved past the end date', 'fixture', 'true',
    (public.resolve_recurring_due_date(sat, 1, 'none') > sat)::text);
  perform pg_temp.rec('D1 scheduled on the end date (Sat), posts after it', 'v_upcoming_recurring',
    'shown, due ' || public.resolve_recurring_due_date(sat, 1, 'none'), pg_temp.vstate(s));
  perform pg_temp.snap('D1 scheduled on the end date, posts after it', s, false);

  -- ================================================================ Timing rules
  -- R1 each value the form writes saves, and resolves as the TS cadence
  -- does (lib/recurringTiming.test.ts); forward / backward are refused.
  -- The list that saves is compared with NON_BUSINESS_DAY_RULES by the
  -- parity runner.
  declare
    rule  text;
    saved text[] := '{}';
  begin
    foreach rule in array array['none', 'before', 'after', 'forward', 'backward'] loop
      begin
        s := pg_temp.sched(u, chk, rent, 'R1 rule ' || rule, sat, null, null);
        update public.recurring_transactions
           set non_business_day_rule = rule,
               next_due_date = public.resolve_recurring_due_date(sat, 0, rule)
         where id = s;
        saved := saved || rule;
        perform pg_temp.rec('R1 timing rule ' || rule || ' saves', 'v_upcoming_recurring',
          'shown, due ' || public.resolve_recurring_due_date(sat, 0, rule), pg_temp.vstate(s));
        -- The Saturday moves the way the rule says: earlier, later, or not at all.
        perform pg_temp.rec('R1 timing rule ' || rule || ' moves the Saturday', 'resolve_recurring_due_date',
          case rule when 'before' then 'earlier' when 'after' then 'later' else 'same day' end,
          case sign(public.resolve_recurring_due_date(sat, 0, rule) - sat)
            when -1 then 'earlier' when 1 then 'later' else 'same day' end);
      exception when check_violation then
        perform pg_temp.rec('R1 timing rule ' || rule || ' is refused', 'recurring_transactions',
          case when rule in ('forward', 'backward') then 'refused' else 'saves' end, 'refused');
      end;
    end loop;
    perform pg_temp.rec('R1 the rules that save = NON_BUSINESS_DAY_RULES', 'rule-values',
      (select string_agg(v, ',' order by v) from ends_ts, jsonb_array_elements_text(payload->'rules') v),
      array_to_string(array(select unnest(saved) order by 1), ','));
  end;

  -- ================================================================ Goal funding
  -- G1 a goal funded by a recurring transfer holds nothing while the
  -- transfer runs, and holds again once it has ended -- the same day.
  s := gen_random_uuid();
  insert into public.recurring_transactions (id, userid, accountid, to_accountid, description, amount,
    frequency, next_run_date, start_date, next_due_date, end_date)
  values (s, u, chk, sav, 'G1 to savings', 100, 'Monthly', t - 35, t - 35, t - 35, t + 5);
  insert into public.goals (id, userid, goal_name, goal_type, target_amount, monthly_contribution, is_active, funding_recurringid)
  values (gl, u, 'ZZ ends goal', 'Vacation', 5000, 200, true, s);
  perform pg_temp.landed(s);
  perform pg_temp.rec('G1 funding transfer running', 'v_goal_monthly_holds', '0',
    (select count(*)::text from public.v_goal_monthly_holds where goalid = gl));
  perform pg_temp.landed(s);
  perform pg_temp.rec('G1 funding transfer ended (next cycle after t+5)', 'v_upcoming_recurring (funding picker)',
    'not shown', pg_temp.vstate(s));
  perform pg_temp.rec('G1 funding transfer ended', 'v_goal_monthly_holds', '1',
    (select count(*)::text from public.v_goal_monthly_holds where goalid = gl));
  perform pg_temp.snap('G1 funding transfer ended', s, true);
end $$;

-- Pure rule cases, no fixture: (cursor, end, limit, done) -> finished.
insert into er (scenario, consumer, expected, actual, pass,
                next_run_date, end_date, occurrence_limit, occurrences_done, sql_finished, sql_remaining)
select 'R ' || label, 'state', case when want then 'finished' else 'open' end,
       case when public.recurring_is_finished(nr, ed, lim, done) then 'finished' else 'open' end,
       public.recurring_is_finished(nr, ed, lim, done) = want,
       nr, ed, lim, done,
       public.recurring_is_finished(nr, ed, lim, done),
       public.recurring_occurrences_remaining(lim, done)
  from (values
    ('no end',                      date '2026-12-01', null::date,        null::integer, 0::bigint, false),
    ('no end, many done',           date '2026-12-01', null,              null,          40,        false),
    ('limit 3, 2 done',             date '2026-12-01', null,              3,             2,         false),
    ('limit 3, 3 done',             date '2026-12-01', null,              3,             3,         true),
    ('limit 1, 2 done (overshot)',  date '2026-12-01', null,              1,             2,         true),
    ('end = cursor',                date '2026-12-01', date '2026-12-01', null,          0,         false),
    ('end day before cursor',       date '2026-12-01', date '2026-11-30', null,          0,         true),
    ('end long past, cursor before',date '2020-01-01', date '2020-01-02', null,          0,         false),
    ('both, limit binds',           date '2026-12-01', date '2027-12-01', 2,             2,         true),
    ('both, date binds',            date '2026-12-01', date '2026-11-01', 5,             1,         true)
  ) as c(label, nr, ed, lim, done, want);

-- P1 every TS case, recomputed by the SQL rule on the same inputs.
insert into er (scenario, consumer, expected, actual, pass)
select 'P1 next ' || case c.rel when -1 then 'before end' when 0 then 'on end' when 1 then 'after end' else 'no end' end
         || ' / limit ' || coalesce(c.lim::text, 'none') || ' / done ' || c.done,
       'parity grid',
       c.finished::text || ' ' || coalesce(c.remaining::text, 'null'),
       x.f::text || ' ' || coalesce(x.rm::text, 'null'),
       x.f = c.finished and x.rm is not distinct from c.remaining::bigint
  from ends_ts,
       jsonb_to_recordset(payload->'cases') as c(rel integer, lim integer, done integer, finished boolean, remaining integer)
 cross join lateral (
   select public.recurring_is_finished(
            date '2026-12-01',
            case c.rel when -1 then date '2026-12-02' when 0 then date '2026-12-01' when 1 then date '2026-11-30' end,
            c.lim, c.done) as f,
          public.recurring_occurrences_remaining(c.lim, c.done) as rm
 ) x;

-- P2 every state row against the TS answer for its inputs. The grid's
-- done runs 0..6, past the largest limit any case uses, so capping at 6
-- changes no answer.
insert into er (scenario, consumer, expected, actual, pass)
select 'P2 ' || e.scenario, 'parity state',
       coalesce(c.finished::text || ' ' || coalesce(c.remaining::text, 'null'), '<no TS case>'),
       e.sql_finished::text || ' ' || coalesce(e.sql_remaining::text, 'null'),
       coalesce(c.finished = e.sql_finished and c.remaining::bigint is not distinct from e.sql_remaining, false)
  from er e
  left join (
    select c.*
      from ends_ts,
           jsonb_to_recordset(payload->'cases') as c(rel integer, lim integer, done integer, finished boolean, remaining integer)
  ) c
    on c.rel is not distinct from sign(e.next_run_date - e.end_date)::integer
   and c.lim is not distinct from e.occurrence_limit
   and c.done = least(e.occurrences_done, 6)
 where e.consumer = 'state';

set local role none;

select seq, scenario, consumer, expected, actual, pass,
       next_run_date, end_date, occurrence_limit, occurrences_done, sql_finished, sql_remaining
  from er
union all
select 2147483647, 'SUMMARY', count(*)::text || ' rows',
       count(*) filter (where not pass)::text || ' false',
       case when count(*) filter (where not pass) = 0 then 'ALL PASS' else 'NOT PASSED' end,
       count(*) filter (where not pass) = 0,
       null, null, null, null, null, null
  from er
order by 1;

rollback;
