-- =====================================================================
-- RLS isolation test
--
-- Run against the linked project after any migration that touches
-- tables, views, grants, policies or functions:
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/rls-isolation-test.sql
--
-- Returns one row per assertion (section, object, check, expected,
-- actual, pass). Read every row; a run is clean only when every `pass`
-- is true.
--
-- Self-cleaning: everything runs in ONE transaction that ends in
-- ROLLBACK. The harness creates two throwaway users (A and B) in
-- auth.users -- the on_auth_user_created trigger builds their profiles,
-- settings and default categories -- seeds one row per table for each,
-- then impersonates them. No row is ever committed: other sessions never
-- see them (uncommitted), and an error part-way aborts the transaction
-- the same way. All ids are uuids, so no sequence advances either.
--
-- Keep the BEGIN/ROLLBACK pair and keep every statement between them.
-- Do not run sections piecemeal in an autocommit client. Fixture ids are
-- fixed (aaaaaaaa-.../bbbbbbbb-...), so if a run were ever committed the
-- next run fails loudly on a duplicate key in auth.users rather than
-- passing on stale rows. Cleanup check after a run (must be 0):
--   select count(*) from auth.users where email like 'rls-test-%@example.invalid';
--   select count(*) from public.waitlist where email like 'rls-test-%@example.invalid';
--
-- Impersonation is the PostgREST pattern: request.jwt.claims carries the
-- user's sub, and the role becomes `authenticated`, so auth.uid() and
-- every RLS policy behave exactly as they do for a real request.
--
-- Sections
--   1  Reads      B counts A's rows in every table: must be 0
--   2  Views      same, for every v_* view
--   3  Writes     B updates/deletes A's rows, inserts as A, hands own
--                 rows to A
--   4  Cross-tenant references
--                 B inserts a row under B's own userid that points at
--                 A's account/category/goal. FK checks bypass RLS, so
--                 only a policy or trigger can stop this.
--   6  Same-user writes
--                 A writes to A's own parents in every shape the app
--                 uses: the guard against a WITH CHECK that's too strict
--   7  Trigger oracles
--                 DEFINER triggers must answer the same for another
--                 user's category as for a made-up id
--   8  Composite foreign keys
--                 the section 4 references written as the table owner
--                 (RLS bypassed) must be rejected by the FK itself
--   5  Coverage   every public table/view is tested here or exempted
--   2d Function grants (Phase 7)
--   2e Waitlist   operator-only table (migration 51): anon and
--                 authenticated can't read or touch it; join_waitlist()
--                 answers a duplicate exactly as it answers a new address
--   2f Definer write functions
--                 link_transaction_to_schedule() (migration 60): B can't
--                 link A's transaction, link to A's schedule, or learn
--                 either exists; A can link A's own (the control)
--   2g Same-bill answers (migration 66)
--   2k Month recap (migration 71): month_story() as B shows only B's
--                 logs and goal money, none of A's goals or cards; A's
--                 own call is the control
--   2l Goal pace (migration 72): goal_pace() as B lists only B's goals,
--                 never A's, and B's pace is B's own money; A's own call
--                 (A's pace from A's two months) is the control
--   2i Goal links (migration 69)
--                 same_goal_money() shows B nothing of A's;
--                 replace_contribution_with_link() can't delete A's
--                 contribution; A's own pair is the control
--   2h Import (migration 68): import_transactions(), import_preview() and
--                 undo_import() refuse another user's account and import;
--                 list_imports() shows only your own; the control (A imports
--                 into A's account and undoes it) works
--                 confirm_same_bill() and record_different_bill() refuse
--                 B on A's rows like a made-up id; clear_different_bill()
--                 as B leaves A's answer; A can answer A's own (the control)
--
-- Every "must be 0" read carries a positive control: A must see the
-- same row the table owner sees. Without it, a 0 from B proves nothing
-- (a broken fixture also returns 0), so a vacuous 0 is reported as a
-- failure, not a pass.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Harness plumbing (temp objects, gone at rollback)
-- ---------------------------------------------------------------------
create temp table rls_results (
  seq      serial primary key,
  section  text not null,
  object   text not null,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);

create temp table rls_fx (k text primary key, id uuid not null);

create function pg_temp.fx(p_k text) returns uuid language sql stable as $$
  select id from rls_fx where k = p_k
$$;

create function pg_temp.rec(p_section text, p_object text, p_check text,
                            p_expected text, p_actual text, p_pass boolean)
returns void language sql as $$
  insert into rls_results (section, object, check_, expected, actual, pass)
  values (p_section, p_object, p_check, p_expected, p_actual, coalesce(p_pass, false))
$$;

-- Become a signed-in user, exactly as PostgREST does for a request.
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

-- count(*) of p_sql run as p_user (null user = table owner, RLS bypassed).
create function pg_temp.count_as(p_user uuid, p_sql text) returns bigint
language plpgsql as $$
declare v bigint;
begin
  if p_user is not null then perform pg_temp.become(p_user); end if;
  execute p_sql into v;
  if p_user is not null then perform pg_temp.unbecome(); end if;
  return v;
end
$$;

-- Run a write as p_user (null user = table owner, RLS bypassed).
-- Returns rows affected, or the error it raised.
create function pg_temp.try_as(p_user uuid, p_sql text,
  out n bigint, out state text, out msg text)
language plpgsql as $$
begin
  if p_user is not null then perform pg_temp.become(p_user); end if;
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when others then
    state := sqlstate;
    msg   := sqlerrm;
  end;
  perform pg_temp.unbecome();
end
$$;

-- Fingerprint of one row as the table owner sees it (null = row gone).
create function pg_temp.row_hash(p_rel text, p_key text, p_id uuid) returns text
language plpgsql as $$
declare v text;
begin
  execute format('select md5(t::text) from public.%I t where %I = $1', p_rel, p_key)
    into v using p_id;
  return v;
end
$$;


-- ---------------------------------------------------------------------
-- Fixtures: users A and B, one row per user-scoped table each
-- ---------------------------------------------------------------------
insert into rls_fx values
  ('A', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('B', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

insert into auth.users (id, instance_id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'rls-test-' || lower(k) || '@example.invalid', '{}'::jsonb,
       jsonb_build_object('first_name', 'Rls', 'last_name', 'User' || k),
       now(), now()
  from rls_fx where k in ('A', 'B');

-- Trigger-owned rows, looked up rather than inserted.
insert into rls_fx
select u.k || '_' || v.k, v.id
  from rls_fx u
 cross join lateral (
   select 'settings', s.id from public.settings s where s.userid = u.id
   union all
   select 'group', g.id from public.category_groups g
    where g.userid = u.id and g.name = 'Food & Dining'
   union all
   select 'groceries', c.id from public.categories c
    where c.userid = u.id and c.category_name = 'Groceries'
   union all
   select 'rent', c.id from public.categories c
    where c.userid = u.id and c.category_name = 'Rent'
   union all
   select 'salary', c.id from public.categories c
    where c.userid = u.id and c.category_name = 'Paychecks/Salary'
 ) as v(k, id)
 where u.k in ('A', 'B');

-- App-owned rows: same shape for both users, fixed ids per user.
insert into rls_fx
select u.k || '_' || v.k,
       (lower(u.k) || lower(u.k) || lower(u.k) || lower(u.k) || lower(u.k) || lower(u.k)
        || lower(u.k) || lower(u.k) || '-0000-4000-8000-0000000000' || v.n)::uuid
  from rls_fx u
 cross join (values ('acct','01'), ('invacct','02'), ('txn','03'), ('budget','04'),
                    ('goal','05'), ('contrib','06'), ('invest','07'), ('notif','08'),
                    ('recur','09'), ('sub','0a'), ('sba','0b'), ('imp','0c')) as v(k, n)
 where u.k in ('A', 'B');

do $$
declare
  u text;
  uid uuid;
begin
  foreach u in array array['A', 'B'] loop
    uid := pg_temp.fx(u);

    insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
    values (pg_temp.fx(u || '_acct'),    uid, 'RLS ' || u || ' checking',   'Checking',   1000, current_date - 30),
           (pg_temp.fx(u || '_invacct'), uid, 'RLS ' || u || ' brokerage',  'Investment', 0,    current_date - 30);

    insert into public.transactions (id, userid, accountid, categoryid, description, amount,
                                     transaction_type, transaction_date)
    values (pg_temp.fx(u || '_txn'), uid, pg_temp.fx(u || '_acct'), pg_temp.fx(u || '_groceries'),
            'RLS ' || u || ' groceries', 25, 'Expense', current_date);

    -- Dated ahead: gives v_future_transactions (migration 65) a row.
    insert into public.transactions (userid, accountid, categoryid, description, amount,
                                     transaction_type, transaction_date)
    values (uid, pg_temp.fx(u || '_acct'), pg_temp.fx(u || '_groceries'),
            'RLS ' || u || ' dated ahead', 7, 'Expense', current_date + 10);

    insert into public.budgets (id, userid, categoryid, budget_amount, budget_month)
    values (pg_temp.fx(u || '_budget'), uid, pg_temp.fx(u || '_groceries'), 100,
            date_trunc('month', current_date)::date);

    -- monthly_contribution: gives v_goal_monthly_holds (migration 57) a row
    -- for each user -- 100 less this month's 50.
    insert into public.goals (id, userid, goal_name, goal_type, target_amount, status, tracking_method, monthly_contribution)
    values (pg_temp.fx(u || '_goal'), uid, 'RLS ' || u || ' goal', 'Custom', 500, 'Active', 'Manual', 100);

    insert into public.goal_contributions (id, userid, goalid, amount, date, funding_method)
    values (pg_temp.fx(u || '_contrib'), uid, pg_temp.fx(u || '_goal'), 50, current_date, 'manual');

    -- The groceries row counts toward the goal: gives v_goal_money
    -- (migration 69) a transaction row for each user, beside the
    -- contribution row.
    update public.transactions set goalid = pg_temp.fx(u || '_goal') where id = pg_temp.fx(u || '_txn');

    -- current_price null: also gives v_integrity_issues a missing_price row.
    insert into public.investments (id, userid, accountid, ticker, shares, average_cost, asset_type)
    values (pg_temp.fx(u || '_invest'), uid, pg_temp.fx(u || '_invacct'), 'RLS', 1, 10, 'Stock');

    insert into public.notifications (id, userid, title, message, notification_type)
    values (pg_temp.fx(u || '_notif'), uid, 'RLS', 'RLS ' || u, 'info');

    -- Due 3 days ago: also gives v_integrity_issues a recurring_overdue row.
    insert into public.recurring_transactions (id, userid, accountid, categoryid, description,
                                               amount, frequency, next_run_date, next_due_date)
    values (pg_temp.fx(u || '_recur'), uid, pg_temp.fx(u || '_acct'), pg_temp.fx(u || '_rent'),
            'RLS ' || u || ' rent', 1200, 'Monthly', current_date - 3, current_date - 3);

    -- A "No, keep both" (migration 66), written as the table owner: the
    -- app can only write it through record_different_bill().
    insert into public.same_bill_answers (id, userid, recurringid, transactionid, answer, occurrence_due_date)
    values (pg_temp.fx(u || '_sba'), uid, pg_temp.fx(u || '_recur'), pg_temp.fx(u || '_txn'),
            'different', current_date - 3);

    -- An import (migration 68), written as the table owner: the app can only
    -- write it through import_transactions().
    insert into public.imports (id, userid, accountid, row_count)
    values (pg_temp.fx(u || '_imp'), uid, pg_temp.fx(u || '_acct'), 1);

    insert into public.subscriptions (id, userid, stripe_customer_id, stripe_subscription_id,
                                      plan, status, renewal_date)
    values (pg_temp.fx(u || '_sub'), uid, 'cus_rls_' || u, 'sub_rls_' || u, 'Pro', 'Active',
            current_date + 30);
  end loop;
end
$$;


-- ---------------------------------------------------------------------
-- 1 Reads + 2 Views
--
-- For each object: what the owner sees for A (truth), what A sees
-- (positive control, must equal truth and be > 0), what B sees of A
-- (must be 0), and every row B can see that isn't B's (must be 0 --
-- this catches leaks of ANY other user, including real ones).
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.fx('A');
  b uuid := pg_temp.fx('B');
  r record;
  v_truth bigint;
  v_as_a  bigint;
  v_as_b  bigint;
  v_foreign bigint;
begin
  for r in
    select * from (values
      -- section,  object,                   rows of A,                                          rows not B's
      ('1 reads', 'accounts',               format('userid = %L', a),                            format('userid <> %L', b)),
      ('1 reads', 'budgets',                format('userid = %L', a),                            format('userid <> %L', b)),
      ('1 reads', 'categories',             format('userid = %L', a),                            format('userid <> %L', b)),
      ('1 reads', 'category_groups',        format('userid = %L', a),                            format('userid <> %L', b)),
      ('1 reads', 'goal_contributions',     format('goalid = %L', pg_temp.fx('A_goal')),         format('goalid <> %L', pg_temp.fx('B_goal'))),
      ('1 reads', 'goals',                  format('userid = %L', a),                            format('userid <> %L', b)),
      ('1 reads', 'investments',            format('userid = %L', a),                            format('userid <> %L', b)),
      ('1 reads', 'notifications',          format('userid = %L', a),                            format('userid <> %L', b)),
      ('1 reads', 'profiles',               format('id = %L', a),                                format('id <> %L', b)),
      ('1 reads', 'imports',                format('userid = %L', a),                            format('userid <> %L', b)),
      ('1 reads', 'recurring_transactions', format('userid = %L', a),                            format('userid <> %L', b)),
      ('1 reads', 'same_bill_answers',      format('userid = %L', a),                            format('userid <> %L', b)),
      ('1 reads', 'settings',               format('userid = %L', a),                            format('userid <> %L', b)),
      ('1 reads', 'subscriptions',          format('userid = %L', a),                            format('userid <> %L', b)),
      ('1 reads', 'transactions',           format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_account_balances',     format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_budget_vs_actual',     format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_category_activity',    format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_category_spending',    format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_daily_cashflow',       format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_future_transactions',  format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_goal_money',           format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_goal_monthly_holds',   format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_goal_progress',        format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_goals_summary',        format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_integrity_issues',     format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_investment_holdings',  format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_monthly_cashflow',     format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_net_worth',            format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_portfolio_summary',    format('userid = %L', a),                            format('userid <> %L', b)),
      -- Every schedule's amount and basis (migration 59); A_recur gives A a row.
      ('2 views', 'v_recurring_amounts',    format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_upcoming_recurring',   format('userid = %L', a),                            format('userid <> %L', b))
    ) as t(section, rel, a_rows, not_b_rows)
  loop
    v_truth   := pg_temp.count_as(null, format('select count(*) from public.%I where %s', r.rel, r.a_rows));
    v_as_a    := pg_temp.count_as(a,    format('select count(*) from public.%I where %s', r.rel, r.a_rows));
    v_as_b    := pg_temp.count_as(b,    format('select count(*) from public.%I where %s', r.rel, r.a_rows));
    v_foreign := pg_temp.count_as(b,    format('select count(*) from public.%I where %s', r.rel, r.not_b_rows));

    perform pg_temp.rec(r.section, r.rel, 'control: A sees own rows',
      format('= owner count (%s), > 0', v_truth), v_as_a::text,
      v_as_a = v_truth and v_truth > 0);

    perform pg_temp.rec(r.section, r.rel, 'B reads A''s rows',
      '0', v_as_b::text || case when v_truth = 0 then ' (VACUOUS: A has no rows)' else '' end,
      v_as_b = 0 and v_truth > 0);

    perform pg_temp.rec(r.section, r.rel, 'B reads any row not B''s',
      '0', v_foreign::text, v_foreign = 0);
  end loop;
end
$$;


-- ---------------------------------------------------------------------
-- 3 Writes
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.fx('A');
  b uuid := pg_temp.fx('B');
  r record;
  w record;
  v_before text;
  v_after  text;
  v_actual text;
  v_pass   boolean;
begin
  for r in
    select * from (values
      -- object,                 key,  A's row,                   B's own row,               owner col, set (harmless edit)
      ('accounts',               'id', pg_temp.fx('A_acct'),     pg_temp.fx('B_acct'),     'userid', 'account_name = ''rls-b-was-here'''),
      ('budgets',                'id', pg_temp.fx('A_budget'),   pg_temp.fx('B_budget'),   'userid', 'budget_amount = 999'),
      ('categories',             'id', pg_temp.fx('A_groceries'),pg_temp.fx('B_groceries'),'userid', 'category_name = ''rls-b-was-here'''),
      ('category_groups',        'id', pg_temp.fx('A_group'),    pg_temp.fx('B_group'),    'userid', 'name = ''rls-b-was-here'''),
      ('goal_contributions',     'id', pg_temp.fx('A_contrib'),  pg_temp.fx('B_contrib'),  'goalid', 'amount = 999'),
      ('goals',                  'id', pg_temp.fx('A_goal'),     pg_temp.fx('B_goal'),     'userid', 'goal_name = ''rls-b-was-here'''),
      ('imports',                'id', pg_temp.fx('A_imp'),      pg_temp.fx('B_imp'),      'userid', 'row_count = 999'),
      ('investments',            'id', pg_temp.fx('A_invest'),   pg_temp.fx('B_invest'),   'userid', 'ticker = ''HACK'''),
      ('notifications',          'id', pg_temp.fx('A_notif'),    pg_temp.fx('B_notif'),    'userid', 'is_read = true'),
      ('profiles',               'id', a,                        b,                        'id',     'first_name = ''rls-b-was-here'''),
      ('recurring_transactions', 'id', pg_temp.fx('A_recur'),    pg_temp.fx('B_recur'),    'userid', 'description = ''rls-b-was-here'''),
      ('same_bill_answers',      'id', pg_temp.fx('A_sba'),      pg_temp.fx('B_sba'),      'userid', 'occurrence_due_date = current_date'),
      ('settings',               'id', pg_temp.fx('A_settings'), pg_temp.fx('B_settings'), 'userid', 'currency = ''XXX'''),
      ('subscriptions',          'id', pg_temp.fx('A_sub'),      pg_temp.fx('B_sub'),      'userid', 'plan = ''Premium'''),
      ('transactions',           'id', pg_temp.fx('A_txn'),      pg_temp.fx('B_txn'),      'userid', 'description = ''rls-b-was-here''')
    ) as t(rel, key, a_row, b_row, owner_col, set_sql)
  loop
    -- UPDATE A's row: 0 rows affected, A's row byte-identical afterwards.
    v_before := pg_temp.row_hash(r.rel, r.key, r.a_row);
    select * into w from pg_temp.try_as(b, format('update public.%I set %s where %I = %L', r.rel, r.set_sql, r.key, r.a_row));
    v_after  := pg_temp.row_hash(r.rel, r.key, r.a_row);
    v_actual := coalesce(w.n::text || ' rows', 'error ' || w.state || ': ' || w.msg)
             || case when v_before is not distinct from v_after then '; A row intact' else '; A ROW CHANGED' end;
    v_pass   := v_before is not null and v_before = v_after
                and (w.n = 0 or (w.state = '42501' and w.msg like 'permission denied%'));
    perform pg_temp.rec('3 writes', r.rel, 'B UPDATEs A''s row', '0 rows (or no grant); A row intact', v_actual, v_pass);

    -- DELETE A's row: 0 rows affected, A's row still there.
    v_before := pg_temp.row_hash(r.rel, r.key, r.a_row);
    select * into w from pg_temp.try_as(b, format('delete from public.%I where %I = %L', r.rel, r.key, r.a_row));
    v_after  := pg_temp.row_hash(r.rel, r.key, r.a_row);
    v_actual := coalesce(w.n::text || ' rows', 'error ' || w.state || ': ' || w.msg)
             || case when v_after is null then '; A ROW DELETED'
                     when v_before = v_after then '; A row intact' else '; A ROW CHANGED' end;
    v_pass   := v_before is not null and v_before = v_after
                and (w.n = 0 or (w.state = '42501' and w.msg like 'permission denied%'));
    perform pg_temp.rec('3 writes', r.rel, 'B DELETEs A''s row', '0 rows (or no grant); A row intact', v_actual, v_pass);

    -- UPDATE own row to hand it to A: the UPDATE policy's WITH CHECK must
    -- reject it, or B can push rows into A's account.
    select * into w from pg_temp.try_as(b, format('update public.%I set %I = %L where %I = %L',
           r.rel, r.owner_col,
           case r.owner_col when 'goalid' then pg_temp.fx('A_goal') else a end,
           r.key, r.b_row));
    v_actual := coalesce('accepted, ' || w.n::text || ' rows', 'rejected ' || w.state || ': ' || w.msg);
    v_pass   := w.state = '42501'
                and (w.msg like 'new row violates row-level security policy%' or w.msg like 'permission denied%');
    perform pg_temp.rec('3 writes', r.rel, 'B UPDATEs own row to ' || r.owner_col || ' = A',
      'rejected: WITH CHECK (42501)', v_actual, v_pass);
  end loop;

  -- INSERT with A as owner. Every other column is valid for B (B's own
  -- account/category), so the only thing wrong with the row is its owner;
  -- the rejection has to come from RLS, not a CHECK or FK.
  for r in
    select * from (values
      ('accounts',               format('insert into public.accounts (userid, account_name, account_type) values (%L, ''rls'', ''Checking'')', a)),
      ('budgets',                format('insert into public.budgets (userid, categoryid, budget_amount, budget_month) values (%L, %L, 1, %L)', a, pg_temp.fx('B_rent'), date_trunc('month', current_date)::date)),
      ('categories',             format('insert into public.categories (userid, groupid, category_name, category_type) values (%L, %L, ''rls'', ''Expense'')', a, pg_temp.fx('B_group'))),
      ('category_groups',        format('insert into public.category_groups (userid, name) values (%L, ''rls'')', a)),
      ('goal_contributions',     format('insert into public.goal_contributions (userid, goalid, amount, date, funding_method) values (%L, %L, 1, current_date, ''manual'')', a, pg_temp.fx('A_goal'))),
      ('goals',                  format('insert into public.goals (userid, goal_name, goal_type, target_amount) values (%L, ''rls'', ''Custom'', 1)', a)),
      ('imports',                format('insert into public.imports (userid, accountid, row_count) values (%L, %L, 1)', a, pg_temp.fx('B_acct'))),
      ('investments',            format('insert into public.investments (userid, accountid, ticker, shares, average_cost, asset_type) values (%L, %L, ''RLS2'', 1, 1, ''Stock'')', a, pg_temp.fx('B_invacct'))),
      ('notifications',          format('insert into public.notifications (userid, title, message, notification_type) values (%L, ''rls'', ''rls'', ''info'')', a)),
      ('profiles',               format('insert into public.profiles (id, first_name, last_name) values (%L, ''rls'', ''rls'')', a)),
      ('recurring_transactions', format('insert into public.recurring_transactions (userid, accountid, categoryid, description, amount, frequency, next_run_date, next_due_date) values (%L, %L, %L, ''rls'', 1, ''Monthly'', current_date + 5, current_date + 5)', a, pg_temp.fx('B_acct'), pg_temp.fx('B_rent'))),
      ('same_bill_answers',      format('insert into public.same_bill_answers (userid, recurringid, transactionid, answer, occurrence_due_date) values (%L, %L, %L, ''different'', current_date)', a, pg_temp.fx('B_recur'), pg_temp.fx('B_txn'))),
      ('settings',               format('insert into public.settings (userid) values (%L)', a)),
      ('subscriptions',          format('insert into public.subscriptions (userid, stripe_customer_id, stripe_subscription_id, renewal_date) values (%L, ''cus_x'', ''sub_x'', current_date)', a)),
      ('transactions',           format('insert into public.transactions (userid, accountid, categoryid, description, amount, transaction_type, transaction_date) values (%L, %L, %L, ''rls'', 1, ''Expense'', current_date)', a, pg_temp.fx('B_acct'), pg_temp.fx('B_groceries')))
    ) as t(rel, sql)
  loop
    select * into w from pg_temp.try_as(b, r.sql);
    v_actual := case
      when w.state is null then 'ACCEPTED, ' || w.n::text || ' rows'
      when w.state = '42501' and w.msg like 'new row violates row-level security policy%'
        then 'rejected: WITH CHECK (42501)'
      when w.state = '42501' and w.msg like 'permission denied%'
        then 'rejected: no INSERT grant (42501)'
      else 'rejected for another reason ' || w.state || ': ' || w.msg
    end;
    v_pass := w.state = '42501';
    perform pg_temp.rec('3 writes', r.rel,
      case r.rel when 'goal_contributions' then 'B INSERTs onto A''s goal'
                 when 'profiles' then 'B INSERTs with id = A'
                 else 'B INSERTs with userid = A' end,
      'rejected: WITH CHECK (42501)', v_actual, v_pass);
  end loop;
end
$$;


-- ---------------------------------------------------------------------
-- 4 Cross-tenant references
--
-- The row is B's (userid = B), so every policy's WITH CHECK passes. What
-- it points at is A's. A foreign key check bypasses RLS, so if nothing
-- else stops it, B can attach rows to A's objects. Consequences:
--   * ON DELETE RESTRICT parents (accounts, categories, groups,
--     recurring_transactions) become undeletable by A -- including by
--     delete_own_account(), which cascades through them.
--   * ON DELETE CASCADE children (B's budget on A's category) are
--     deleted by A's actions.
--   * Success vs FK error tells B whether a guessed id exists.
-- What RLS DOES still guarantee: A never sees B's row, so A's figures
-- are unaffected -- checked at the end of this section.
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.fx('A');
  b uuid := pg_temp.fx('B');
  r record;
  w record;
  v_a_acct     uuid;
  v_bal_before numeric;
  v_bal_after  numeric;
begin
  v_a_acct     := pg_temp.fx('A_acct');
  v_bal_before := (select balance from public.v_account_balances where account_id = v_a_acct);

  for r in
    select * from (values
      ('transactions',           'accountid -> A''s account',
        format('insert into public.transactions (userid, accountid, categoryid, description, amount, transaction_type, transaction_date) values (%L, %L, %L, ''rls'', 5, ''Expense'', current_date)', b, pg_temp.fx('A_acct'), pg_temp.fx('B_groceries'))),
      ('transactions',           'categoryid -> A''s category',
        format('insert into public.transactions (userid, accountid, categoryid, description, amount, transaction_type, transaction_date) values (%L, %L, %L, ''rls'', 5, ''Expense'', current_date)', b, pg_temp.fx('B_acct'), pg_temp.fx('A_groceries'))),
      ('transactions',           'goalid -> A''s goal',
        format('insert into public.transactions (userid, accountid, categoryid, goalid, description, amount, transaction_type, transaction_date) values (%L, %L, %L, %L, ''rls'', 5, ''Expense'', current_date)', b, pg_temp.fx('B_acct'), pg_temp.fx('B_groceries'), pg_temp.fx('A_goal'))),
      ('transactions',           'recurringid -> A''s schedule',
        format('insert into public.transactions (userid, accountid, categoryid, recurringid, description, amount, transaction_type, transaction_date) values (%L, %L, %L, %L, ''rls'', 5, ''Expense'', current_date)', b, pg_temp.fx('B_acct'), pg_temp.fx('B_rent'), pg_temp.fx('A_recur'))),
      ('recurring_transactions', 'accountid -> A''s account',
        format('insert into public.recurring_transactions (userid, accountid, categoryid, description, amount, frequency, next_run_date, next_due_date) values (%L, %L, %L, ''rls'', 1, ''Monthly'', current_date + 5, current_date + 5)', b, pg_temp.fx('A_acct'), pg_temp.fx('B_rent'))),
      ('recurring_transactions', 'categoryid -> A''s category',
        format('insert into public.recurring_transactions (userid, accountid, categoryid, description, amount, frequency, next_run_date, next_due_date) values (%L, %L, %L, ''rls'', 1, ''Monthly'', current_date + 5, current_date + 5)', b, pg_temp.fx('B_acct'), pg_temp.fx('A_rent'))),
      ('budgets',                'categoryid -> A''s category',
        format('insert into public.budgets (userid, categoryid, budget_amount, budget_month) values (%L, %L, 1, %L)', b, pg_temp.fx('A_groceries'), (date_trunc('month', current_date) + interval '1 month')::date)),
      ('categories',             'groupid -> A''s group',
        format('insert into public.categories (userid, groupid, category_name, category_type) values (%L, %L, ''rls'', ''Expense'')', b, pg_temp.fx('A_group'))),
      ('investments',            'accountid -> A''s account',
        format('insert into public.investments (userid, accountid, ticker, shares, average_cost, asset_type) values (%L, %L, ''RLS3'', 1, 1, ''Stock'')', b, pg_temp.fx('A_invacct'))),
      ('goals',                  'accountid -> A''s account',
        format('insert into public.goals (userid, goal_name, goal_type, target_amount, accountid) values (%L, ''rls'', ''Custom'', 1, %L)', b, pg_temp.fx('A_acct'))),
      ('goal_contributions',     'transactionid -> A''s transaction',
        format('insert into public.goal_contributions (userid, goalid, transactionid, amount, date, funding_method) values (%L, %L, %L, 1, current_date, ''transaction'')', b, pg_temp.fx('B_goal'), pg_temp.fx('A_txn')))
    ) as t(rel, ref, sql)
  loop
    select * into w from pg_temp.try_as(b, r.sql);
    perform pg_temp.rec('4 cross-tenant refs', r.rel, 'B INSERTs own row, ' || r.ref,
      'rejected',
      coalesce('rejected ' || w.state || ': ' || w.msg, 'ACCEPTED, ' || w.n::text || ' rows'),
      w.state is not null);
  end loop;

  -- Whatever B managed to attach, A's own figures must not move.
  perform pg_temp.become(a);
  v_bal_after := (select balance from public.v_account_balances where account_id = v_a_acct);
  perform pg_temp.unbecome();
  perform pg_temp.rec('4 cross-tenant refs', 'v_account_balances',
    'A''s balance, as A, after B''s attempts',
    format('= %s (owner, before)', v_bal_before), coalesce(v_bal_after::text, 'null'),
    v_bal_after = v_bal_before);
end
$$;


-- ---------------------------------------------------------------------
-- 6 Same-user writes
--
-- The other half of section 4: a WITH CHECK that is slightly too strict
-- silently breaks legitimate writes, and nothing above would notice. A
-- writes to A's own parents, in every shape the app produces -- nullable
-- references both null and set, both transfer legs (categoryid null), and
-- edits on an archived account (ownership must not depend on is_active).
-- Every one must succeed with the stated row count.
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.fx('A');
  r record;
  w record;
begin
  -- Archive A's brokerage account; edits against it must still work.
  update public.accounts set is_active = false where id = pg_temp.fx('A_invacct');

  for r in
    select * from (values
      ('transactions', 'INSERT, own account + category', 1,
        format('insert into public.transactions (userid, accountid, categoryid, description, amount, transaction_type, transaction_date) values (%L, %L, %L, ''rls ok'', 12.34, ''Expense'', current_date)', a, pg_temp.fx('A_acct'), pg_temp.fx('A_groceries'))),
      ('transactions', 'INSERT, own goal + own schedule', 1,
        format('insert into public.transactions (userid, accountid, categoryid, goalid, recurringid, description, amount, transaction_type, transaction_date) values (%L, %L, %L, %L, %L, ''rls ok'', 1200, ''Expense'', current_date)', a, pg_temp.fx('A_acct'), pg_temp.fx('A_rent'), pg_temp.fx('A_goal'), pg_temp.fx('A_recur'))),
      ('transactions', 'INSERT transfer, both legs, categoryid null', 2,
        format('insert into public.transactions (userid, accountid, categoryid, description, amount, transaction_type, transaction_date, transfer_group_id) values (%1$L, %2$L, null, ''rls ok'', 50, ''Expense'', current_date, %4$L), (%1$L, %3$L, null, ''rls ok'', 50, ''Income'', current_date, %4$L)', a, pg_temp.fx('A_acct'), pg_temp.fx('A_invacct'), gen_random_uuid())),
      ('transactions', 'UPDATE own row: amount, description, category', 1,
        format('update public.transactions set amount = 30, description = ''rls edited'', categoryid = %L where id = %L', (select id from public.categories where userid = a and category_name = 'Restaurants'), pg_temp.fx('A_txn'))),
      ('transactions', 'UPDATE own row onto archived account', 1,
        format('update public.transactions set accountid = %L where id = %L', pg_temp.fx('A_invacct'), pg_temp.fx('A_txn'))),
      ('recurring_transactions', 'INSERT, own account + category', 1,
        format('insert into public.recurring_transactions (userid, accountid, categoryid, description, amount, frequency, next_run_date, next_due_date) values (%L, %L, %L, ''rls ok'', 80, ''Monthly'', current_date + 7, current_date + 7)', a, pg_temp.fx('A_acct'), pg_temp.fx('A_rent'))),
      ('recurring_transactions', 'INSERT transfer, own to_account, categoryid null', 1,
        format('insert into public.recurring_transactions (userid, accountid, to_accountid, categoryid, description, amount, frequency, next_run_date, next_due_date) values (%L, %L, %L, null, ''rls ok'', 100, ''Monthly'', current_date + 7, current_date + 7)', a, pg_temp.fx('A_acct'), pg_temp.fx('A_invacct'))),
      ('recurring_transactions', 'UPDATE own schedule amount', 1,
        format('update public.recurring_transactions set amount = 1450 where id = %L', pg_temp.fx('A_recur'))),
      ('budgets', 'INSERT, own category', 1,
        format('insert into public.budgets (userid, categoryid, budget_amount, budget_month) values (%L, %L, 200, %L)', a, pg_temp.fx('A_groceries'), (date_trunc('month', current_date) + interval '1 month')::date)),
      ('budgets', 'UPDATE own budget amount', 1,
        format('update public.budgets set budget_amount = 150 where id = %L', pg_temp.fx('A_budget'))),
      ('categories', 'INSERT, own group', 1,
        format('insert into public.categories (userid, groupid, category_name, category_type) values (%L, %L, ''rls ok'', ''Expense'')', a, pg_temp.fx('A_group'))),
      ('categories', 'UPDATE own category (rename, archive)', 1,
        format('update public.categories set category_name = ''rls edited'', is_active = false where id = %L', pg_temp.fx('A_rent'))),
      ('investments', 'INSERT, own (archived) account', 1,
        format('insert into public.investments (userid, accountid, ticker, shares, average_cost, asset_type) values (%L, %L, ''RLSOK'', 2, 5, ''ETF'')', a, pg_temp.fx('A_invacct'))),
      ('investments', 'UPDATE own holding', 1,
        format('update public.investments set shares = 3 where id = %L', pg_temp.fx('A_invest'))),
      ('goals', 'INSERT, accountid null', 1,
        format('insert into public.goals (userid, goal_name, goal_type, target_amount) values (%L, ''rls ok'', ''Custom'', 100)', a)),
      -- Own account on a goal: the WITH CHECK on goals.accountid. Since
      -- migration 70 a goal can't be INSERTed as LinkedAccount at all
      -- (guard_goal_link) -- that shape, and linking through
      -- link_goal_to_card(), are checked in 6b below.
      ('goals', 'INSERT, own account', 1,
        format('insert into public.goals (userid, goal_name, goal_type, target_amount, accountid) values (%L, ''rls ok'', ''Custom'', 100, %L)', a, pg_temp.fx('A_acct'))),
      ('goals', 'UPDATE own goal', 1,
        format('update public.goals set goal_name = ''rls edited'' where id = %L', pg_temp.fx('A_goal'))),
      ('goal_contributions', 'INSERT manual, transactionid null', 1,
        format('insert into public.goal_contributions (userid, goalid, amount, date, funding_method) values (%L, %L, 10, current_date, ''manual'')', a, pg_temp.fx('A_goal'))),
      ('goal_contributions', 'INSERT from own transaction', 1,
        format('insert into public.goal_contributions (userid, goalid, transactionid, amount, date, funding_method) values (%L, %L, %L, 30, current_date, ''transaction'')', a, pg_temp.fx('A_goal'), pg_temp.fx('A_txn'))),
      ('goal_contributions', 'UPDATE own contribution', 1,
        format('update public.goal_contributions set amount = 60 where id = %L', pg_temp.fx('A_contrib')))
    ) as t(rel, what, rows_expected, sql)
  loop
    select * into w from pg_temp.try_as(a, r.sql);
    perform pg_temp.rec('6 same-user writes', r.rel, 'A ' || r.what,
      format('accepted, %s rows', r.rows_expected),
      coalesce('accepted, ' || w.n::text || ' rows', 'REJECTED ' || w.state || ': ' || w.msg),
      w.n = r.rows_expected);
  end loop;
end
$$;


-- ---------------------------------------------------------------------
-- 6b Same-user writes: a goal follows A's own card
--
-- Migration 70: only link_goal_to_card() writes the follow-a-card
-- columns. A direct INSERT of a LinkedAccount goal is refused by
-- guard_goal_link (42501, naming link_goal_to_card) -- even onto A's own
-- account. The accepted path: A links A's own debt goal to A's own card,
-- and the goal then follows it.
-- ---------------------------------------------------------------------
do $$
declare
  a      uuid := pg_temp.fx('A');
  a_card uuid := gen_random_uuid();
  a_debt uuid := gen_random_uuid();
  w      record;
  v_goal record;
begin
  select * into w from pg_temp.try_as(a,
    format('insert into public.goals (userid, goal_name, goal_type, target_amount, tracking_method, accountid) values (%L, ''rls direct link'', ''Debt Payoff'', 100, ''LinkedAccount'', %L)', a, pg_temp.fx('A_acct')));
  perform pg_temp.rec('6 same-user writes', 'goals', 'A INSERT, LinkedAccount directly (own account)',
    'rejected 42501 by guard_goal_link',
    coalesce('rejected ' || w.state || ': ' || w.msg, 'ACCEPTED, ' || w.n::text || ' rows'),
    w.state = '42501' and w.msg like '%link_goal_to_card()%');

  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (a_card, a, 'rls 6b card', 'Credit Card', -200, current_date - 30);
  insert into public.goals (id, userid, goal_name, goal_type, target_amount)
  values (a_debt, a, 'rls 6b debt', 'Debt Payoff', 200);

  select * into w from pg_temp.try_as(a, format('select public.link_goal_to_card(%L, %L)', a_debt, a_card));
  select tracking_method, accountid into v_goal from public.goals where id = a_debt;
  perform pg_temp.rec('6 same-user writes', 'goals', 'A links own debt goal to own card (link_goal_to_card)',
    'accepted; follows the card',
    coalesce('rejected ' || w.state || ': ' || w.msg,
             'accepted; ' || coalesce(v_goal.tracking_method, 'null') || ' -> '
               || case when v_goal.accountid = a_card then 'the card' else coalesce(v_goal.accountid::text, 'null') end),
    w.state is null and v_goal.tracking_method = 'LinkedAccount' and v_goal.accountid = a_card);
end
$$;


-- ---------------------------------------------------------------------
-- 7 Trigger oracles
--
-- enforce_category_type() and enforce_recurring_variability_scope() are
-- SECURITY DEFINER BEFORE triggers, so they run before RLS checks the
-- new row. If they can see another user's category, their answer differs
-- for a foreign id vs a made-up one -- telling B the id exists and its
-- type. Each pair below must get the SAME response for A's category as
-- for a random uuid (ids masked before comparing).
--
-- Guards: the triggers must still do their job on the user's own
-- categories.
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.fx('A');
  b uuid := pg_temp.fx('B');
  r record;
  w_foreign record;
  w_bogus   record;
  v_f text;
  v_b text;
  w record;
  v_bogus_id uuid := gen_random_uuid();
begin
  for r in
    select * from (values
      ('transactions', 'Expense on A''s Income category',
        format('insert into public.transactions (userid, accountid, categoryid, description, amount, transaction_type, transaction_date) values (%L, %L, %%L, ''rls'', 1, ''Expense'', current_date)', b, pg_temp.fx('B_acct')),
        pg_temp.fx('A_salary')),
      ('transactions', 'Expense on A''s Expense category',
        format('insert into public.transactions (userid, accountid, categoryid, description, amount, transaction_type, transaction_date) values (%L, %L, %%L, ''rls'', 1, ''Expense'', current_date)', b, pg_temp.fx('B_acct')),
        pg_temp.fx('A_groceries')),
      ('recurring_transactions', 'requires_confirmation on A''s Income category',
        format('insert into public.recurring_transactions (userid, accountid, categoryid, description, amount, frequency, next_run_date, next_due_date, requires_confirmation) values (%L, %L, %%L, ''rls'', 1, ''Monthly'', current_date + 5, current_date + 5, true)', b, pg_temp.fx('B_acct')),
        pg_temp.fx('A_salary')),
      ('recurring_transactions', 'requires_confirmation on A''s Expense category',
        format('insert into public.recurring_transactions (userid, accountid, categoryid, description, amount, frequency, next_run_date, next_due_date, requires_confirmation) values (%L, %L, %%L, ''rls'', 1, ''Monthly'', current_date + 5, current_date + 5, true)', b, pg_temp.fx('B_acct')),
        pg_temp.fx('A_groceries')),
      ('recurring_transactions', 'date_tolerance_days on A''s Expense category',
        format('insert into public.recurring_transactions (userid, accountid, categoryid, description, amount, frequency, next_run_date, next_due_date, date_tolerance_days) values (%L, %L, %%L, ''rls'', 1, ''Monthly'', current_date + 5, current_date + 5, 3)', b, pg_temp.fx('B_acct')),
        pg_temp.fx('A_groceries')),
      ('recurring_transactions', 'amount_is_variable on A''s Expense category',
        format('insert into public.recurring_transactions (userid, accountid, categoryid, description, amount, frequency, next_run_date, next_due_date, amount_is_variable) values (%L, %L, %%L, ''rls'', 1, ''Monthly'', current_date + 5, current_date + 5, true)', b, pg_temp.fx('B_acct')),
        pg_temp.fx('A_groceries'))
    ) as t(rel, what, sql_tmpl, foreign_id)
  loop
    select * into w_foreign from pg_temp.try_as(b, format(r.sql_tmpl, r.foreign_id));
    select * into w_bogus   from pg_temp.try_as(b, format(r.sql_tmpl, v_bogus_id));
    v_f := coalesce(w_foreign.state || ': ' || regexp_replace(w_foreign.msg, '[0-9a-f-]{36}', '<id>', 'g'), 'ACCEPTED');
    v_b := coalesce(w_bogus.state   || ': ' || regexp_replace(w_bogus.msg,   '[0-9a-f-]{36}', '<id>', 'g'), 'ACCEPTED');
    perform pg_temp.rec('7 trigger oracles', r.rel, 'B: ' || r.what || ' vs random id',
      'same rejection for both',
      case when v_f = v_b then 'same: ' || v_f else 'A''s: ' || v_f || ' | random: ' || v_b end,
      v_f = v_b and w_foreign.state is not null);
  end loop;

  -- Guards: own-category checks still enforced, legitimate shape still accepted.
  for r in
    select * from (values
      ('transactions', 'A: Expense on own Income category', 'rejected 23514',
        format('insert into public.transactions (userid, accountid, categoryid, description, amount, transaction_type, transaction_date) values (%L, %L, %L, ''rls'', 1, ''Expense'', current_date)', a, pg_temp.fx('A_acct'), pg_temp.fx('A_salary'))),
      ('recurring_transactions', 'A: requires_confirmation on own Expense category', 'rejected 23514',
        format('insert into public.recurring_transactions (userid, accountid, categoryid, description, amount, frequency, next_run_date, next_due_date, requires_confirmation) values (%L, %L, %L, ''rls'', 1, ''Monthly'', current_date + 5, current_date + 5, true)', a, pg_temp.fx('A_acct'), pg_temp.fx('A_groceries'))),
      ('recurring_transactions', 'A: requires_confirmation on own Income category', 'accepted',
        format('insert into public.recurring_transactions (userid, accountid, categoryid, description, amount, frequency, next_run_date, next_due_date, requires_confirmation) values (%L, %L, %L, ''rls'', 1, ''Monthly'', current_date + 5, current_date + 5, true)', a, pg_temp.fx('A_acct'), pg_temp.fx('A_salary'))),
      ('recurring_transactions', 'A: variable date + amount on own Expense category', 'accepted',
        format('insert into public.recurring_transactions (userid, accountid, categoryid, description, amount, frequency, next_run_date, next_due_date, date_tolerance_days, amount_is_variable) values (%L, %L, %L, ''rls'', 1, ''Monthly'', current_date + 5, current_date + 5, 3, true)', a, pg_temp.fx('A_acct'), pg_temp.fx('A_groceries')))
    ) as t(rel, what, expected, sql)
  loop
    select * into w from pg_temp.try_as(a, r.sql);
    perform pg_temp.rec('7 trigger oracles', r.rel, r.what, r.expected,
      coalesce('rejected ' || w.state || ': ' || w.msg, 'accepted'),
      case r.expected when 'accepted' then w.state is null
                      else w.state = '23514' end);
  end loop;
end
$$;


-- ---------------------------------------------------------------------
-- 8 Composite foreign keys (migration 44)
--
-- Section 4 proves RLS rejects cross-user references. This proves the
-- schema does, with RLS out of the way: every write runs as the table
-- owner, the path service_role, a SECURITY DEFINER function or a
-- support-side fix takes. Each must be rejected by the named FK (23503),
-- not by a CHECK or trigger that happens to fire first.
--
-- Then the ON DELETE SET NULL FKs: deleting the parent must null only the
-- reference and leave userid alone (the column-list form).
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.fx('A');
  b uuid := pg_temp.fx('B');
  r record;
  w record;
  v_goal uuid := gen_random_uuid();
  v_recur uuid := gen_random_uuid();
  v_acct uuid := gen_random_uuid();
  v_txn_goal uuid := gen_random_uuid();
  v_txn_recur uuid := gen_random_uuid();
  v_goal_linked uuid := gen_random_uuid();
  v_goal_funded uuid := gen_random_uuid();
  v_row record;
begin
  for r in
    select * from (values
      ('transactions_accountid_fkey',
        format('insert into public.transactions (userid, accountid, categoryid, description, amount, transaction_type, transaction_date) values (%L, %L, %L, ''rls'', 5, ''Expense'', current_date)', b, pg_temp.fx('A_acct'), pg_temp.fx('B_groceries'))),
      ('transactions_categoryid_fkey',
        format('insert into public.transactions (userid, accountid, categoryid, description, amount, transaction_type, transaction_date) values (%L, %L, %L, ''rls'', 5, ''Expense'', current_date)', b, pg_temp.fx('B_acct'), pg_temp.fx('A_groceries'))),
      ('transactions_goalid_fkey',
        format('insert into public.transactions (userid, accountid, categoryid, goalid, description, amount, transaction_type, transaction_date) values (%L, %L, %L, %L, ''rls'', 5, ''Expense'', current_date)', b, pg_temp.fx('B_acct'), pg_temp.fx('B_groceries'), pg_temp.fx('A_goal'))),
      -- current_date - 1: section 6 posted A's schedule today, and
      -- recurring_tx_no_double_post (checked immediately) would fire
      -- before the FK (checked at end of statement).
      ('transactions_recurringid_fkey',
        format('insert into public.transactions (userid, accountid, categoryid, recurringid, description, amount, transaction_type, transaction_date) values (%L, %L, %L, %L, ''rls'', 5, ''Expense'', current_date - 1)', b, pg_temp.fx('B_acct'), pg_temp.fx('B_rent'), pg_temp.fx('A_recur'))),
      ('recurring_transactions_accountid_fkey',
        format('insert into public.recurring_transactions (userid, accountid, categoryid, description, amount, frequency, next_run_date, next_due_date) values (%L, %L, %L, ''rls'', 1, ''Monthly'', current_date + 5, current_date + 5)', b, pg_temp.fx('A_acct'), pg_temp.fx('B_rent'))),
      ('recurring_transactions_to_accountid_fkey',
        format('insert into public.recurring_transactions (userid, accountid, to_accountid, categoryid, description, amount, frequency, next_run_date, next_due_date) values (%L, %L, %L, null, ''rls'', 1, ''Monthly'', current_date + 5, current_date + 5)', b, pg_temp.fx('B_acct'), pg_temp.fx('A_acct'))),
      ('recurring_transactions_categoryid_fkey',
        format('insert into public.recurring_transactions (userid, accountid, categoryid, description, amount, frequency, next_run_date, next_due_date) values (%L, %L, %L, ''rls'', 1, ''Monthly'', current_date + 5, current_date + 5)', b, pg_temp.fx('B_acct'), pg_temp.fx('A_rent'))),
      ('investments_accountid_fkey',
        format('insert into public.investments (userid, accountid, ticker, shares, average_cost, asset_type) values (%L, %L, ''RLS8'', 1, 1, ''Stock'')', b, pg_temp.fx('A_invacct'))),
      ('budgets_categoryid_fkey',
        format('insert into public.budgets (userid, categoryid, budget_amount, budget_month) values (%L, %L, 1, %L)', b, pg_temp.fx('A_groceries'), (date_trunc('month', current_date) + interval '2 months')::date)),
      ('goals_accountid_fkey',
        format('insert into public.goals (userid, goal_name, goal_type, target_amount, accountid) values (%L, ''rls'', ''Custom'', 1, %L)', b, pg_temp.fx('A_acct'))),
      ('categories_groupid_fkey',
        format('insert into public.categories (userid, groupid, category_name, category_type) values (%L, %L, ''rls'', ''Expense'')', b, pg_temp.fx('A_group'))),
      ('goal_contributions_goalid_fkey',
        format('insert into public.goal_contributions (userid, goalid, amount, date, funding_method) values (%L, %L, 1, current_date, ''manual'')', b, pg_temp.fx('A_goal'))),
      ('goal_contributions_transactionid_fkey',
        format('insert into public.goal_contributions (userid, goalid, transactionid, amount, date, funding_method) values (%L, %L, %L, 1, current_date, ''transaction'')', b, pg_temp.fx('B_goal'), pg_temp.fx('A_txn'))),
      -- Re-pointing an existing row is the same hole by UPDATE.
      ('transactions_accountid_fkey',
        format('update public.transactions set accountid = %L where id = %L', pg_temp.fx('A_acct'), pg_temp.fx('B_txn'))),
      ('goal_contributions_goalid_fkey',
        format('update public.goal_contributions set goalid = %L where id = %L', pg_temp.fx('A_goal'), pg_temp.fx('B_contrib'))),
      -- Migration 57: a goal's funding transfer must be its own user's.
      ('goals_funding_recurringid_fkey',
        format('update public.goals set funding_recurringid = %L where id = %L', pg_temp.fx('A_recur'), pg_temp.fx('B_goal'))),
      -- Migration 68: an import is about its own user's account, and a
      -- transaction can only belong to its own user's import.
      ('imports_accountid_fkey',
        format('insert into public.imports (userid, accountid, row_count) values (%L, %L, 1)', b, pg_temp.fx('A_acct'))),
      ('transactions_import_fkey',
        format('update public.transactions set import_id = %L where id = %L', pg_temp.fx('A_imp'), pg_temp.fx('B_txn'))),
      -- Migration 66: an answer is about its own user's schedule and entry.
      ('same_bill_answers_recurringid_fkey',
        format('insert into public.same_bill_answers (userid, recurringid, transactionid, answer, occurrence_due_date) values (%L, %L, %L, ''different'', current_date)', b, pg_temp.fx('A_recur'), pg_temp.fx('B_txn'))),
      ('same_bill_answers_transactionid_fkey',
        format('insert into public.same_bill_answers (userid, recurringid, transactionid, answer, occurrence_due_date) values (%L, %L, %L, ''different'', current_date)', b, pg_temp.fx('B_recur'), pg_temp.fx('A_txn')))
    ) as t(fk, sql)
  loop
    select * into w from pg_temp.try_as(null, r.sql);
    perform pg_temp.rec('8 composite FKs', r.fk,
      'owner (RLS bypassed): B row -> A''s parent, ' || split_part(r.sql, ' ', 1),
      'rejected 23503 by ' || r.fk,
      coalesce('rejected ' || w.state || ': ' || w.msg, 'ACCEPTED, ' || w.n::text || ' rows'),
      w.state = '23503' and w.msg like '%"' || r.fk || '"%');
  end loop;

  -- SET NULL (column list): parent deleted -> reference nulled, userid kept.
  insert into public.goals (id, userid, goal_name, goal_type, target_amount)
  values (v_goal, a, 'rls fk goal', 'Custom', 1);
  insert into public.recurring_transactions (id, userid, accountid, categoryid, description, amount,
                                             frequency, next_run_date, next_due_date)
  values (v_recur, a, pg_temp.fx('A_acct'), pg_temp.fx('A_rent'), 'rls fk recur', 1, 'Monthly',
          current_date + 5, current_date + 5);
  insert into public.accounts (id, userid, account_name, account_type)
  values (v_acct, a, 'rls fk acct', 'Savings');
  insert into public.transactions (id, userid, accountid, categoryid, goalid, description, amount,
                                   transaction_type, transaction_date)
  values (v_txn_goal, a, pg_temp.fx('A_acct'), pg_temp.fx('A_groceries'), v_goal, 'rls fk', 1,
          'Expense', current_date);
  -- Dated before A_acct's balance date (current_date - 30), so it carries
  -- the pre-anchor answer migration 62 requires (SRA01 otherwise): "Yes,
  -- it's already counted", against the account's current anchor. The
  -- date only keeps the row clear of every other fixture; this section
  -- tests the recurringid FK's SET NULL, which the answer doesn't touch.
  insert into public.transactions (id, userid, accountid, categoryid, recurringid, description, amount,
                                   transaction_type, transaction_date,
                                   counts_despite_anchor, anchor_answer_set_at)
  values (v_txn_recur, a, pg_temp.fx('A_acct'), pg_temp.fx('A_rent'), v_recur, 'rls fk', 1,
          'Expense', current_date - 400,
          false, (select opening_set_at from public.accounts where id = pg_temp.fx('A_acct')));
  insert into public.goals (id, userid, goal_name, goal_type, target_amount, accountid)
  values (v_goal_linked, a, 'rls fk linked', 'Custom', 1, v_acct);
  insert into public.goals (id, userid, goal_name, goal_type, target_amount, funding_recurringid)
  values (v_goal_funded, a, 'rls fk funded', 'Custom', 1, v_recur);

  delete from public.goals where id = v_goal;
  delete from public.recurring_transactions where id = v_recur;
  delete from public.accounts where id = v_acct;

  for v_row in
    select 'transactions_goalid_fkey' as fk, t.goalid as ref, t.userid from public.transactions t where t.id = v_txn_goal
    union all
    select 'transactions_recurringid_fkey', t.recurringid, t.userid from public.transactions t where t.id = v_txn_recur
    union all
    select 'goals_accountid_fkey', g.accountid, g.userid from public.goals g where g.id = v_goal_linked
    union all
    select 'goals_funding_recurringid_fkey', g.funding_recurringid, g.userid from public.goals g where g.id = v_goal_funded
  loop
    perform pg_temp.rec('8 composite FKs', v_row.fk, 'parent deleted: SET NULL nulls the reference only',
      'ref null, userid = A',
      format('ref %s, userid %s', coalesce(v_row.ref::text, 'null'),
             case when v_row.userid = a then 'A' else coalesce(v_row.userid::text, 'null') end),
      v_row.ref is null and v_row.userid = a);
  end loop;
end
$$;


-- ---------------------------------------------------------------------
-- 2e -- Waitlist (migration 51)
--
-- Not user data, so not in section 1: it has no userid and no policy.
-- The operator is its only reader. What must hold:
--   - anon and authenticated: no SELECT/INSERT/UPDATE/DELETE, and an
--     actual attempt is refused (not just the grant read back)
--   - join_waitlist() as anon: a new address and the same address again
--     answer identically (no error either time) and leave ONE row,
--     stored trimmed and lower-cased
--   - at the hourly ceiling, a duplicate and a new address are refused
--     identically too
-- ---------------------------------------------------------------------
create function pg_temp.become_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end
$$;

do $$
declare
  v_role text;
  v_priv text;
  v_has boolean;
  v_sql text;
  v_state text;
  v_msg text;
  v_first text;
  v_second text;
  v_n bigint;
  v_raw constant text := '  RLS-Test-Waitlist@Example.invalid ';
  v_email constant text := 'rls-test-waitlist@example.invalid';
begin
  -- Grants, read back.
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      v_has := has_table_privilege(v_role, 'public.waitlist', v_priv);
      perform pg_temp.rec('2e waitlist', 'waitlist', v_role || ' ' || v_priv || ' granted',
        'false', v_has::text, not v_has);
    end loop;
  end loop;

  v_has := has_function_privilege('anon', 'public.join_waitlist(text)'::regprocedure, 'execute');
  perform pg_temp.rec('2e waitlist', 'join_waitlist(text)', 'anon EXECUTE', 'true', v_has::text, v_has);
  v_has := has_function_privilege('authenticated', 'public.join_waitlist(text)'::regprocedure, 'execute');
  perform pg_temp.rec('2e waitlist', 'join_waitlist(text)', 'authenticated EXECUTE', 'false', v_has::text, not v_has);

  -- Join twice as anon, the way PostgREST runs an unauthenticated rpc.
  for i in 1..2 loop
    v_state := null;
    begin
      perform pg_temp.become_anon();
      perform public.join_waitlist(v_raw);
    exception when others then
      v_state := sqlstate;
    end;
    perform pg_temp.unbecome();
    if i = 1 then v_first := coalesce(v_state, 'ok'); else v_second := coalesce(v_state, 'ok'); end if;
  end loop;
  perform pg_temp.rec('2e waitlist', 'join_waitlist(text)', 'new address as anon', 'ok', v_first, v_first = 'ok');
  perform pg_temp.rec('2e waitlist', 'join_waitlist(text)', 'same address again: identical answer',
    v_first, v_second, v_second = v_first);

  -- Positive control for the refusals below: the owner sees the one row.
  select count(*) into v_n from public.waitlist where email = v_email;
  perform pg_temp.rec('2e waitlist', 'waitlist', 'owner: one row, normalised', '1', v_n::text, v_n = 1);

  -- Every direct statement, attempted as anon and as a signed-in user.
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_sql in array array[
      'select count(*) from public.waitlist',
      format('insert into public.waitlist (email) values (%L)', 'rls-test-direct@example.invalid'),
      format('update public.waitlist set created_at = now() where email = %L', v_email),
      format('delete from public.waitlist where email = %L', v_email)
    ] loop
      v_state := null;
      begin
        if v_role = 'anon' then
          perform pg_temp.become_anon();
        else
          perform pg_temp.become(pg_temp.fx('A'));
        end if;
        execute v_sql;
      exception when others then
        v_state := sqlstate;
      end;
      perform pg_temp.unbecome();
      perform pg_temp.rec('2e waitlist', 'waitlist', v_role || ': ' || split_part(v_sql, ' ', 1) || ' refused',
        '42501', coalesce(v_state, 'ran'), v_state = '42501');
    end loop;
  end loop;

  select count(*) into v_n from public.waitlist where email like 'rls-test-%@example.invalid';
  perform pg_temp.rec('2e waitlist', 'waitlist', 'owner: still one test row after the refusals',
    '1', v_n::text, v_n = 1);

  -- The shape check in SQL, for a caller that skipped the app.
  v_state := null;
  begin
    perform pg_temp.become_anon();
    perform public.join_waitlist('not an address');
  exception when others then
    v_state := sqlstate;
  end;
  perform pg_temp.unbecome();
  perform pg_temp.rec('2e waitlist', 'join_waitlist(text)', 'implausible address rejected', '22023',
    coalesce(v_state, 'ok'), v_state = '22023');

  -- The hourly ceiling (100). Fill to it as the owner; now() is fixed for
  -- the transaction, so every filler row is inside the window.
  insert into public.waitlist (email)
  select format('rls-test-fill-%s@example.invalid', g)
    from generate_series(1, 100 - (select count(*) from public.waitlist
                                    where created_at > now() - interval '1 hour')::int) g;

  for i in 1..2 loop
    v_state := null;
    v_msg := null;
    begin
      perform pg_temp.become_anon();
      perform public.join_waitlist(case i when 1 then v_email else 'rls-test-new@example.invalid' end);
    exception when others then
      v_state := sqlstate;
      v_msg := sqlerrm;
    end;
    perform pg_temp.unbecome();
    perform pg_temp.rec('2e waitlist', 'join_waitlist(text)',
      'at the ceiling: ' || case i when 1 then 'duplicate' else 'new address' end || ' refused',
      'P0001 waitlist_rate_limited', coalesce(v_state || ' ' || v_msg, 'ok'),
      v_state = 'P0001' and v_msg = 'waitlist_rate_limited');
  end loop;
end
$$;


-- ---------------------------------------------------------------------
-- 2 views -- v_recurring_amounts reads as the caller
--
-- The read checks above prove B sees none of A's rows today; this pins
-- the reason. Without security_invoker a view reads as its owner and
-- returns every user's rows (CLAUDE.md, "Any migration that creates a
-- view"). docs/view-acl-check.sql checks every view this way after a
-- push; this keeps it in the harness for the one the coverage check
-- found untested (2026-11-18).
-- ---------------------------------------------------------------------
do $$
declare
  v_invoker boolean;
begin
  select coalesce('security_invoker=true' = any (c.reloptions), false) into v_invoker
    from pg_class c
   where c.oid = 'public.v_recurring_amounts'::regclass;
  perform pg_temp.rec('2 views', 'v_recurring_amounts', 'security_invoker set',
    'true', coalesce(v_invoker::text, 'null'), v_invoker is true);
end
$$;


-- ---------------------------------------------------------------------
-- 5 Coverage
--
-- Fails when a migration adds a table or view this file doesn't test.
-- Add the new object to sections 1-3 (or 2), or to the exemption list
-- with a reason.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname, c.relkind, c.relrowsecurity
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'v', 'm', 'p')
     order by c.relname
  loop
    perform pg_temp.rec('5 coverage', r.relname,
      case r.relkind when 'r' then 'table' when 'p' then 'table' when 'v' then 'view' else 'matview' end
        || ' is tested or exempt',
      'tested',
      case
        when r.relname = 'bank_holidays' then 'exempt: global reference data, SELECT using (true)'
        when r.relname = 'waitlist' and exists (select 1 from rls_results where section = '2e waitlist')
          then 'tested in 2e' || case when not r.relrowsecurity then ', but RLS DISABLED' else '' end
        when r.relname in (select object from rls_results where section in ('1 reads', '2 views'))
          then 'tested' || case when r.relkind in ('r', 'p') and not r.relrowsecurity then ', but RLS DISABLED' else '' end
        else 'NOT TESTED'
      end,
      r.relname = 'bank_holidays'
        or (r.relname = 'waitlist' and r.relrowsecurity
            and exists (select 1 from rls_results where section = '2e waitlist'))
        or (r.relname in (select object from rls_results where section in ('1 reads', '2 views'))
            and (r.relkind not in ('r', 'p') or r.relrowsecurity)));
  end loop;
end
$$;


-- ---------------------------------------------------------------------
-- 2c -- Money functions
--
-- security invoker functions that sum a user's money: each caller must
-- get their own total, never one that includes the other user. Truth is
-- the owner's sum for that user alone. By this point the write sections
-- have moved A's balance (it can be negative), so the guard against a
-- vacuous pass is non-zero, not positive.
--
-- The spendable set (Checking, Cash -- migration 54) is restated here on
-- purpose, not read from is_spendable_account_type(): this is an
-- independent oracle, so a change to the set has to change it too.
-- ---------------------------------------------------------------------
do $$
declare
  u text;
  uid uuid;
  v_truth bigint;
  v_actual bigint;
begin
  foreach u in array array['A', 'B'] loop
    uid := pg_temp.fx(u);
    v_truth := pg_temp.count_as(null, format(
      'select (coalesce(sum(balance), 0) * 100)::bigint from public.v_account_balances
        where userid = %L and is_active and account_type in (''Checking'', ''Cash'')', uid));
    v_actual := pg_temp.count_as(uid,
      'select (public.spendable_cash_balance() * 100)::bigint');
    perform pg_temp.rec('2c money functions', 'spendable_cash_balance()',
      u || ' gets own total (cents)', format('%s, non-zero', v_truth), v_actual::text,
      v_actual = v_truth and v_truth <> 0);
  end loop;
end
$$;


-- ---------------------------------------------------------------------
-- 2d -- Function grants
--
-- Postgres grants EXECUTE to PUBLIC on every new function, so a
-- SECURITY DEFINER function is callable by anon through /rest/v1/rpc/*
-- unless a migration revokes it. These grants were read once (Phase 7,
-- 2026-10-04); this makes them a check, so a later migration cannot
-- re-open one silently.
--
-- email_for_username matters most: re-granted, it turns any username
-- into an email address -- an email-harvesting primitive.
-- ---------------------------------------------------------------------
do $$
declare
  v_check record;
  v_actual boolean;
begin
  for v_check in
    select * from (values
      -- function signature,                                     role,            expected
      ('public.email_for_username(text)',                        'anon',          false),
      ('public.email_for_username(text)',                        'authenticated', false),
      ('public.seed_default_categories(uuid)',                   'anon',          false),
      ('public.seed_default_categories(uuid)',                   'authenticated', false),
      ('public.delete_own_account()',                            'anon',          false),
      ('public.delete_own_account()',                            'authenticated', true),
      ('public.spendable_cash_balance()',                        'anon',          false),
      ('public.spendable_cash_balance()',                        'authenticated', true),
      -- The balance anchor rule and its readers (migration 48), and the
      -- Accounts page subtotals (49). Signed-in only. Migration 62
      -- replaced anchor_includes' 4-argument form with the 6-argument one
      -- (the stored answer) and counts_toward_balance_preview with
      -- balance_anchor_preview; same grants (62, lines 96-97, 190-191).
      ('public.anchor_includes(date,timestamptz,date,timestamptz,boolean,timestamptz)', 'anon',          false),
      ('public.anchor_includes(date,timestamptz,date,timestamptz,boolean,timestamptz)', 'authenticated', true),
      ('public.counts_toward_balance(public.transactions)',      'anon',          false),
      ('public.counts_toward_balance(public.transactions)',      'authenticated', true),
      ('public.balance_anchor_preview(uuid,date,uuid)',          'anon',          false),
      ('public.balance_anchor_preview(uuid,date,uuid)',          'authenticated', true),
      ('public.account_type_subtotals(boolean)',                 'anon',          false),
      ('public.account_type_subtotals(boolean)',                 'authenticated', true),
      -- Trigger functions: closed in migration 36 so nobody has to
      -- re-reason about them. 48's are closed the same way.
      ('public.lock_transaction_created_at()',                   'anon',          false),
      ('public.lock_transaction_created_at()',                   'authenticated', false),
      ('public.lock_account_opening_set_at()',                   'anon',          false),
      ('public.lock_account_opening_set_at()',                   'authenticated', false),
      ('public.stamp_account_opening_set_at()',                  'anon',          false),
      ('public.stamp_account_opening_set_at()',                  'authenticated', false),
      ('public.handle_new_user()',                               'anon',          false),
      ('public.handle_new_user()',                               'authenticated', false),
      ('public.enforce_category_type()',                         'anon',          false),
      ('public.enforce_category_type()',                         'authenticated', false),
      ('public.enforce_recurring_variability_scope()',           'anon',          false),
      ('public.enforce_recurring_variability_scope()',           'authenticated', false),
      -- "Make recurring" links its source (migration 60). Signed-in only.
      ('public.link_transaction_to_schedule(uuid,uuid)',         'anon',          false),
      ('public.link_transaction_to_schedule(uuid,uuid)',         'authenticated', true),
      -- The recurring form's side of a goal's funding link (migration 57).
      ('public.set_goal_funding(uuid,uuid)',                     'anon',          false),
      ('public.set_goal_funding(uuid,uuid)',                     'authenticated', true),
      -- "Is this the same bill?" (migration 66). Signed-in only; the
      -- delete trigger's function is closed like every trigger function.
      ('public.confirm_same_bill(uuid,uuid,date,date,date)',     'anon',          false),
      ('public.confirm_same_bill(uuid,uuid,date,date,date)',     'authenticated', true),
      ('public.record_different_bill(uuid,uuid,date)',           'anon',          false),
      ('public.record_different_bill(uuid,uuid,date)',           'authenticated', true),
      ('public.clear_different_bill(uuid,uuid)',                 'anon',          false),
      ('public.clear_different_bill(uuid,uuid)',                 'authenticated', true),
      ('public.same_bill_restores(uuid,date)',                   'anon',          false),
      ('public.same_bill_restores(uuid,date)',                   'authenticated', true),
      ('public.same_bill_delete_preview(uuid[])',                'anon',          false),
      ('public.same_bill_delete_preview(uuid[])',                'authenticated', true),
      ('public.restore_same_bill_occurrence()',                  'anon',          false),
      ('public.restore_same_bill_occurrence()',                  'authenticated', false),
      -- Import (migration 68). Signed-in only. same_bill_answer() is the
      -- core both "Yes" paths share: closed to everyone but the definer
      -- functions that call it.
      ('public.import_preview(uuid,date[])',                     'anon',          false),
      ('public.import_preview(uuid,date[])',                     'authenticated', true),
      ('public.import_transactions(uuid,jsonb,boolean,uuid)',    'anon',          false),
      ('public.import_transactions(uuid,jsonb,boolean,uuid)',    'authenticated', true),
      ('public.undo_import(uuid)',                               'anon',          false),
      ('public.undo_import(uuid)',                               'authenticated', true),
      ('public.list_imports()',                                  'anon',          false),
      ('public.list_imports()',                                  'authenticated', true),
      ('public.same_bill_answer(uuid,uuid,date,date,date,boolean)', 'anon',          false),
      ('public.same_bill_answer(uuid,uuid,date,date,date,boolean)', 'authenticated', false),
      -- Goal links (migration 69). Signed-in only; the completion trigger's
      -- function is closed like every trigger function.
      ('public.same_goal_money(uuid)',                           'anon',          false),
      ('public.same_goal_money(uuid)',                           'authenticated', true),
      ('public.replace_contribution_with_link(uuid,uuid)',       'anon',          false),
      ('public.replace_contribution_with_link(uuid,uuid)',       'authenticated', true),
      ('public.transactions_sync_goal_completed_at()',           'anon',          false),
      ('public.transactions_sync_goal_completed_at()',           'authenticated', false),
      ('public.update_transfer(uuid,uuid,uuid,numeric,date,text,text,boolean,boolean,timestamptz,boolean,timestamptz,boolean,uuid)', 'anon', false),
      ('public.update_transfer(uuid,uuid,uuid,numeric,date,text,text,boolean,boolean,timestamptz,boolean,timestamptz,boolean,uuid)', 'authenticated', true),
      -- Debt goals that follow a card (migration 70). Signed-in only; the
      -- trigger functions are closed like every trigger function.
      ('public.link_goal_to_card(uuid,uuid)',                    'anon',          false),
      ('public.link_goal_to_card(uuid,uuid)',                    'authenticated', true),
      ('public.unlink_goal_from_card(uuid)',                     'anon',          false),
      ('public.unlink_goal_from_card(uuid)',                     'authenticated', true),
      ('public.sync_card_goal_completion(uuid,date[],boolean)',  'anon',          false),
      ('public.sync_card_goal_completion(uuid,date[],boolean)',  'authenticated', true),
      ('public.guard_goal_link()',                               'anon',          false),
      ('public.guard_goal_link()',                               'authenticated', false),
      ('public.refuse_money_to_followed_goal()',                 'anon',          false),
      ('public.refuse_money_to_followed_goal()',                 'authenticated', false),
      ('public.transactions_sync_card_goals()',                  'anon',          false),
      ('public.transactions_sync_card_goals()',                  'authenticated', false),
      ('public.accounts_sync_card_goals()',                      'anon',          false),
      ('public.accounts_sync_card_goals()',                      'authenticated', false),
      -- The month recap (migration 71). Signed-in only; the full grant
      -- block, so service_role holds no EXECUTE on month_story either.
      ('public.month_story(date)',                               'anon',          false),
      ('public.month_story(date)',                               'authenticated', true),
      ('public.month_story(date)',                               'service_role',  false),
      ('public.user_time_zone(uuid)',                            'anon',          false),
      ('public.user_time_zone(uuid)',                            'authenticated', true),
      -- Goal pace (migration 72). Signed-in only; the full grant block.
      ('public.goal_pace()',                                     'anon',          false),
      ('public.goal_pace()',                                     'authenticated', true),
      ('public.goal_pace()',                                     'service_role',  false),
      -- Migration 73: grants stated explicitly, so dev's stock default
      -- privileges can't decide them. Trigger functions: not callable.
      ('public.clear_estimate_on_amount_change()',               'anon',          false),
      ('public.clear_estimate_on_amount_change()',               'authenticated', false),
      ('public.enforce_transfer_pair()',                         'anon',          false),
      ('public.enforce_transfer_pair()',                         'authenticated', false),
      ('public.goal_contributions_sync_completed_at()',          'anon',          false),
      ('public.goal_contributions_sync_completed_at()',          'authenticated', false),
      ('public.goals_sync_completed_at()',                       'anon',          false),
      ('public.goals_sync_completed_at()',                       'authenticated', false),
      ('public.set_updated_at()',                                'anon',          false),
      ('public.set_updated_at()',                                'authenticated', false),
      -- Callable helpers read by views and triggers: signed in only.
      ('public.add_business_days(date,integer)',                 'anon',          false),
      ('public.add_business_days(date,integer)',                 'authenticated', true),
      ('public.estimate_expense_amount_high(uuid,numeric)',      'anon',          false),
      ('public.estimate_expense_amount_high(uuid,numeric)',      'authenticated', true),
      ('public.goal_completed_at(uuid,numeric,timestamptz)',     'anon',          false),
      ('public.goal_completed_at(uuid,numeric,timestamptz)',     'authenticated', true),
      ('public.has_three_supplied_amounts(uuid,text)',           'anon',          false),
      ('public.has_three_supplied_amounts(uuid,text)',           'authenticated', true),
      ('public.is_business_day(date)',                           'anon',          false),
      ('public.is_business_day(date)',                           'authenticated', true),
      ('public.resolve_recurring_due_date(date,integer,text)',   'anon',          false),
      ('public.resolve_recurring_due_date(date,integer,text)',   'authenticated', true),
      ('public.signed_amount(numeric,text)',                     'anon',          false),
      ('public.signed_amount(numeric,text)',                     'authenticated', true),
      -- Migration 74 (ruled 2026-11-18): no username login, so nobody
      -- calls this; it answered "is this username taken?" for anyone.
      ('public.username_is_available(text)',                     'anon',          false),
      ('public.username_is_available(text)',                     'authenticated', false),
      -- Deliberately anon: the pre-request hook runs on every request
      -- (migration 42) -- losing this takes the API down.
      ('public.apply_user_timezone()',                           'anon',          true),
      ('public.apply_user_timezone()',                           'authenticated', true)
    ) as t(fn, role, expected)
  loop
    v_actual := has_function_privilege(v_check.role, v_check.fn::regprocedure, 'execute');
    perform pg_temp.rec('2d function grants', v_check.fn, v_check.role || ' EXECUTE',
      v_check.expected::text, v_actual::text, v_actual = v_check.expected);
  end loop;
end
$$;



-- ---------------------------------------------------------------------
-- 2f -- Definer write functions: link_transaction_to_schedule()
--
-- SECURITY DEFINER, so RLS doesn't scope it -- its own auth.uid() checks
-- do. B tries each way of reaching A's rows: A's transaction onto A's
-- schedule, A's transaction onto B's, B's onto A's. Each must refuse with
-- the same "not found" (P0002) a made-up id gets -- no oracle -- and
-- leave both rows exactly as they were.
--
-- Its own rows, made here as the table owner: earlier sections move
-- A_txn to another account and confirm A_recur onto today, so neither
-- fixture is a clean source any more. The control (A links A's own)
-- runs last and proves the refusals aren't a broken call.
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.fx('A');
  b uuid := pg_temp.fx('B');
  a_tx uuid := gen_random_uuid();
  b_tx uuid := gen_random_uuid();
  a_sched uuid := gen_random_uuid();
  b_sched uuid := gen_random_uuid();
  v_case record;
  v_try record;
  v_before_a text;
  v_before_b text;
  v_pass boolean;
begin
  insert into public.transactions (id, userid, accountid, categoryid, description, amount,
                                   transaction_type, transaction_date)
  values (a_tx, a, pg_temp.fx('A_acct'), pg_temp.fx('A_rent'), 'rls link source', 900, 'Expense', current_date - 10),
         (b_tx, b, pg_temp.fx('B_acct'), pg_temp.fx('B_rent'), 'rls link source', 900, 'Expense', current_date - 10);
  insert into public.recurring_transactions (id, userid, accountid, categoryid, description,
                                             amount, frequency, next_run_date, start_date, next_due_date)
  values (a_sched, a, pg_temp.fx('A_acct'), pg_temp.fx('A_rent'), 'rls link', 900, 'Monthly',
          current_date + 20, current_date - 10, current_date + 20),
         (b_sched, b, pg_temp.fx('B_acct'), pg_temp.fx('B_rent'), 'rls link', 900, 'Monthly',
          current_date + 20, current_date - 10, current_date + 20);

  v_before_a := pg_temp.row_hash('transactions', 'id', a_tx);
  v_before_b := pg_temp.row_hash('transactions', 'id', b_tx);

  for v_case in
    select * from (values
      ('B: A''s transaction onto A''s schedule', a_tx, a_sched),
      ('B: A''s transaction onto B''s schedule', a_tx, b_sched),
      ('B: B''s transaction onto A''s schedule', b_tx, a_sched),
      ('B: made-up transaction (the oracle baseline)', gen_random_uuid(), b_sched)
    ) as t(what, tx, sched)
  loop
    select * into v_try from pg_temp.try_as(b, format('select public.link_transaction_to_schedule(%L, %L)', v_case.tx, v_case.sched));
    v_pass := v_try.state = 'P0002'
      and pg_temp.row_hash('transactions', 'id', a_tx) is not distinct from v_before_a
      and pg_temp.row_hash('transactions', 'id', b_tx) is not distinct from v_before_b;
    perform pg_temp.rec('2f definer writes', 'link_transaction_to_schedule()', v_case.what,
      'P0002; both rows intact', coalesce(v_try.state, 'no error') || coalesce(': ' || v_try.msg, ''), v_pass);
  end loop;

  -- Control: A links A's own -- the function works, so the refusals above mean something.
  select * into v_try from pg_temp.try_as(a, format('select public.link_transaction_to_schedule(%L, %L)', a_tx, a_sched));
  v_pass := v_try.state is null
    and (select recurringid from public.transactions where id = a_tx) = a_sched;
  perform pg_temp.rec('2f definer writes', 'link_transaction_to_schedule()',
    'control: A links A''s own transaction to A''s schedule', 'linked',
    coalesce(v_try.state || ': ' || v_try.msg, 'linked: ' || coalesce((select recurringid::text from public.transactions where id = a_tx), 'null')),
    v_pass);
end
$$;


-- ---------------------------------------------------------------------
-- 2g -- Same-bill answers (migration 66)
--
-- The three write functions are SECURITY DEFINER, scoped by their own
-- auth.uid() checks. B aims each at A's schedule and A's entry: confirm
-- and record must refuse with the made-up id's P0002 and write nothing,
-- and clear must leave A's "No" where it is. Own rows, made here as the
-- table owner: a schedule and an entry dated ahead, so a "Yes" is
-- possible at all. The control (A answers A's own) runs last.
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.fx('A');
  b uuid := pg_temp.fx('B');
  a_tx uuid := gen_random_uuid();
  a_sched uuid := gen_random_uuid();
  v_case record;
  v_try record;
  v_before_tx text;
  v_before_sched text;
  v_before_answers bigint;
  v_pass boolean;
begin
  insert into public.recurring_transactions (id, userid, accountid, categoryid, description,
                                             amount, frequency, next_run_date, start_date, next_due_date)
  values (a_sched, a, pg_temp.fx('A_acct'), pg_temp.fx('A_rent'), 'rls same bill', 700, 'Monthly',
          current_date + 20, current_date + 20, current_date + 20);
  insert into public.transactions (id, userid, accountid, categoryid, description, amount,
                                   transaction_type, transaction_date)
  values (a_tx, a, pg_temp.fx('A_acct'), pg_temp.fx('A_rent'), 'rls same bill', 700, 'Expense', current_date + 20);

  v_before_tx := pg_temp.row_hash('transactions', 'id', a_tx);
  v_before_sched := pg_temp.row_hash('recurring_transactions', 'id', a_sched);
  v_before_answers := (select count(*) from public.same_bill_answers where userid = a);

  for v_case in
    select * from (values
      ('B: "Yes" on A''s entry and A''s schedule',
       format('select public.confirm_same_bill(%L, %L, %L, %L, %L)', a_tx, a_sched, current_date + 20, current_date + 50, current_date + 50)),
      ('B: "No" on A''s entry and A''s schedule',
       format('select public.record_different_bill(%L, %L, %L)', a_tx, a_sched, current_date + 20)),
      ('B: "Yes" on a made-up schedule (the oracle baseline)',
       format('select public.confirm_same_bill(%L, %L, %L, %L, %L)', pg_temp.fx('B_txn'), gen_random_uuid(), current_date, current_date + 30, current_date + 30))
    ) as t(what, sql)
  loop
    select * into v_try from pg_temp.try_as(b, v_case.sql);
    v_pass := v_try.state = 'P0002'
      and pg_temp.row_hash('transactions', 'id', a_tx) is not distinct from v_before_tx
      and pg_temp.row_hash('recurring_transactions', 'id', a_sched) is not distinct from v_before_sched
      and (select count(*) from public.same_bill_answers where userid = a) = v_before_answers;
    perform pg_temp.rec('2g same-bill answers', 'confirm_same_bill() / record_different_bill()', v_case.what,
      'P0002; A''s rows intact', coalesce(v_try.state, 'no error') || coalesce(': ' || v_try.msg, ''), v_pass);
  end loop;

  -- clear_different_bill() raises nothing for anyone; it must just not reach A's row.
  select * into v_try from pg_temp.try_as(b, format('select public.clear_different_bill(%L, %L)',
    pg_temp.fx('A_txn'), pg_temp.fx('A_recur')));
  v_pass := v_try.state is null
    and exists (select 1 from public.same_bill_answers where id = pg_temp.fx('A_sba'));
  perform pg_temp.rec('2g same-bill answers', 'clear_different_bill()', 'B clears A''s "No"',
    'no error; A''s answer still there',
    coalesce(v_try.state || ': ' || v_try.msg, 'no error')
      || case when exists (select 1 from public.same_bill_answers where id = pg_temp.fx('A_sba'))
              then '; A answer intact' else '; A ANSWER GONE' end,
    v_pass);

  -- Control: A answers A's own pair -- the refusals above mean something.
  select * into v_try from pg_temp.try_as(a, format('select public.confirm_same_bill(%L, %L, %L, %L, %L)',
    a_tx, a_sched, current_date + 20, current_date + 50, current_date + 50));
  v_pass := v_try.state is null
    and (select recurringid from public.transactions where id = a_tx) = a_sched
    and (select answer from public.same_bill_answers where transactionid = a_tx) = 'same';
  perform pg_temp.rec('2g same-bill answers', 'confirm_same_bill()',
    'control: A says "Yes" to A''s own pair', 'linked and answered',
    coalesce(v_try.state || ': ' || v_try.msg,
             'recurringid ' || coalesce((select recurringid::text from public.transactions where id = a_tx), 'null')
             || ', answer ' || coalesce((select answer from public.same_bill_answers where transactionid = a_tx), 'none')),
    v_pass);
end
$$;


-- ---------------------------------------------------------------------
-- 2h -- Import (migration 68)
--
-- import_transactions() and undo_import() are SECURITY DEFINER, scoped by
-- their own auth.uid() checks; import_preview() is security invoker, so
-- RLS scopes its account lookup. B aims each at A's account and A's
-- import: every one must refuse with the made-up id's P0002 and leave A's
-- rows exactly as they were. list_imports() must show B nothing of A's.
-- The control runs last: A imports into A's own account and undoes it, so
-- the refusals above mean something. The date is tomorrow, after A's
-- balance date, so no pre-balance answer is in play.
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.fx('A');
  b uuid := pg_temp.fx('B');
  v_rows jsonb;
  v_case record;
  v_try record;
  v_before_txns bigint;
  v_before_imports bigint;
  v_pass boolean;
  v_import uuid;
  v_seen bigint;
begin
  v_rows := jsonb_build_array(jsonb_build_object(
    'row', 2, 'date', (current_date + 1)::text, 'cents', 100, 'type', 'Expense',
    'description', 'rls import', 'categoryid', pg_temp.fx('A_rent')));
  v_before_txns := (select count(*) from public.transactions where userid = a);
  v_before_imports := (select count(*) from public.imports where userid = a);

  for v_case in
    select * from (values
      ('B imports into A''s account',
       format('select * from public.import_transactions(%L, %L::jsonb, null, null)', pg_temp.fx('A_acct'), v_rows::text)),
      ('B imports into a made-up account (the oracle baseline)',
       format('select * from public.import_transactions(%L, %L::jsonb, null, null)', gen_random_uuid(), v_rows::text)),
      ('B previews against A''s account',
       format('select * from public.import_preview(%L, array[current_date])', pg_temp.fx('A_acct'))),
      ('B undoes A''s import',
       format('select * from public.undo_import(%L)', pg_temp.fx('A_imp')))
    ) as t(what, sql)
  loop
    select * into v_try from pg_temp.try_as(b, v_case.sql);
    v_pass := v_try.state = 'P0002'
      and (select count(*) from public.transactions where userid = a) = v_before_txns
      and (select count(*) from public.imports where userid = a) = v_before_imports
      and exists (select 1 from public.imports where id = pg_temp.fx('A_imp'));
    perform pg_temp.rec('2h import', 'import_transactions() / import_preview() / undo_import()', v_case.what,
      'P0002; A''s rows and import intact',
      coalesce(v_try.state, 'no error') || coalesce(': ' || v_try.msg, ''), v_pass);
  end loop;

  -- list_imports(): B sees none of A's.
  v_seen := pg_temp.count_as(b, format('select count(*) from public.list_imports() where accountid = %L', pg_temp.fx('A_acct')));
  perform pg_temp.rec('2h import', 'list_imports()', 'B lists imports', '0 of A''s',
    v_seen::text || ' of A''s', v_seen = 0);

  -- Control: A imports into A's own account, then undoes it.
  select * into v_try from pg_temp.try_as(a, format('select * from public.import_transactions(%L, %L::jsonb, null, null)',
    pg_temp.fx('A_acct'), v_rows::text));
  select i.id into v_import from public.imports i where i.userid = a and i.id <> pg_temp.fx('A_imp');
  v_pass := v_try.state is null
    and (select count(*) from public.transactions where userid = a) = v_before_txns + 1
    and (select count(*) from public.transactions where import_id = v_import) = 1;
  perform pg_temp.rec('2h import', 'import_transactions()', 'control: A imports into A''s own account',
    'one transaction, carrying the import', coalesce(v_try.state || ': ' || v_try.msg, 'no error'), v_pass);

  select * into v_try from pg_temp.try_as(a, format('select * from public.undo_import(%L)', v_import));
  v_pass := v_try.state is null
    and (select count(*) from public.transactions where userid = a) = v_before_txns
    and not exists (select 1 from public.imports where id = v_import);
  perform pg_temp.rec('2h import', 'undo_import()', 'control: A undoes it',
    'the transaction and the import are gone', coalesce(v_try.state || ': ' || v_try.msg, 'no error'), v_pass);
end
$$;


-- ---------------------------------------------------------------------
-- 2i -- Goal links (migration 69)
--
-- same_goal_money() is security invoker: RLS hides A's transaction and
-- A's contributions from B, so B asking about A's linked transaction gets
-- nothing. replace_contribution_with_link() deletes only through that
-- rule, so B can't delete A's contribution -- P0002, the same answer as a
-- made-up id, and A's contribution is still there. The control: A adds a
-- hand entry matching A's own linked $25 groceries row, sees it paired,
-- and replaces it.
-- ---------------------------------------------------------------------
do $$
declare
  a uuid := pg_temp.fx('A');
  b uuid := pg_temp.fx('B');
  v_try record;
  v_seen bigint;
  v_pass boolean;
  v_match uuid := gen_random_uuid();
  v_link  uuid := gen_random_uuid();
begin
  v_seen := pg_temp.count_as(b, format('select count(*) from public.same_goal_money(%L)', pg_temp.fx('A_txn')));
  perform pg_temp.rec('2i goal links', 'same_goal_money()', 'B asks about A''s linked transaction', '0 rows',
    v_seen::text || ' rows', v_seen = 0);

  for v_try in
    select * from pg_temp.try_as(b, format('select public.replace_contribution_with_link(%L, %L)', pg_temp.fx('A_txn'), pg_temp.fx('A_contrib')))
  loop
    v_pass := v_try.state = 'P0002' and exists (select 1 from public.goal_contributions where id = pg_temp.fx('A_contrib'));
    perform pg_temp.rec('2i goal links', 'replace_contribution_with_link()', 'B deletes A''s contribution through A''s transaction',
      'P0002; A''s contribution intact', coalesce(v_try.state, 'no error') || coalesce(': ' || v_try.msg, ''), v_pass);
  end loop;

  -- B links B's own transaction to A's goal: the composite FK refuses it
  -- (section 4 covers the insert; this is the update).
  for v_try in
    select * from pg_temp.try_as(b, format('update public.transactions set goalid = %L where id = %L', pg_temp.fx('A_goal'), pg_temp.fx('B_txn')))
  loop
    -- Either layer may refuse first: the WITH CHECK on transactions
    -- (parent ownership, migration 37; 42501) runs before the composite
    -- FK (44; 23503). Both are refusals; anything else -- including no
    -- error -- fails. The row is checked unchanged as well.
    perform pg_temp.rec('2i goal links', 'transactions.goalid', 'B points B''s own row at A''s goal',
      'rejected 42501 or 23503; B''s row unchanged',
      coalesce(v_try.state || ': ' || v_try.msg, 'no error'),
      v_try.state in ('42501', '23503')
        and not exists (select 1 from public.transactions
                         where id = pg_temp.fx('B_txn') and goalid = pg_temp.fx('A_goal')));
  end loop;

  -- Control: A's own pair, on a linked row made here. Not A_txn: by now
  -- section 6 has edited it to $30 and moved it to the brokerage account,
  -- so a $25 hand entry correctly doesn't match it (the rule is the same
  -- amount) -- which is why this control read 0 / P0002 on 2026-11-18.
  -- docs/same-goal-money-repro.sql shows both cases outside the harness.
  insert into public.transactions (id, userid, accountid, categoryid, goalid, description, amount,
                                   transaction_type, transaction_date)
  values (v_link, a, pg_temp.fx('A_acct'), pg_temp.fx('A_groceries'), pg_temp.fx('A_goal'),
          'rls 2i link', 25, 'Expense', current_date);
  insert into public.goal_contributions (id, userid, goalid, amount, date, funding_method)
  values (v_match, a, pg_temp.fx('A_goal'), 25, current_date - 2, 'manual');
  v_seen := pg_temp.count_as(a, format('select count(*) from public.same_goal_money(%L) where contribution_id = %L', v_link, v_match));
  perform pg_temp.rec('2i goal links', 'same_goal_money()', 'control: A sees A''s own matching hand entry', '1',
    v_seen::text, v_seen = 1);
  for v_try in
    select * from pg_temp.try_as(a, format('select public.replace_contribution_with_link(%L, %L)', v_link, v_match))
  loop
    v_pass := v_try.state is null and not exists (select 1 from public.goal_contributions where id = v_match);
    perform pg_temp.rec('2i goal links', 'replace_contribution_with_link()', 'control: A replaces A''s own hand entry',
      'the hand entry is gone', coalesce(v_try.state || ': ' || v_try.msg, 'no error'), v_pass);
  end loop;
end
$$;


-- ---------------------------------------------------------------------
-- 2j -- Debt goals that follow a card (migration 70)
--
-- sync_card_goal_completion() takes no user id and acts for the caller:
-- security invoker (RLS hides A's goal from B) and an explicit
-- auth.uid() filter. A's goal follows A's card, the card owes nothing,
-- and the owner has cleared completed_at -- so a sync that reached it
-- would write it. B calls it on A's goal: A's completed_at stays null.
-- B can't link A's goal either (P0002, as for a made-up id), nor B's own
-- goal to A's card. The control: A's own call completes it.
-- ---------------------------------------------------------------------
do $$
declare
  a      uuid := pg_temp.fx('A');
  b      uuid := pg_temp.fx('B');
  a_card uuid := gen_random_uuid();
  a_debt uuid := gen_random_uuid();
  b_debt uuid := gen_random_uuid();
  grp    uuid := gen_random_uuid();
  v_try  record;
  v_done text;
begin
  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (a_card, a, 'rls card', 'Credit Card', -100, current_date - 30);
  insert into public.goals (id, userid, goal_name, goal_type, target_amount)
  values (a_debt, a, 'rls payoff', 'Debt Payoff', 100),
         (b_debt, b, 'rls b payoff', 'Debt Payoff', 100);

  perform pg_temp.become(a);
  perform public.link_goal_to_card(a_debt, a_card);
  perform pg_temp.unbecome();

  insert into public.transactions (userid, accountid, amount, transaction_type, transaction_date, description, transfer_group_id)
  values (a, pg_temp.fx('A_acct'), 100, 'Expense', current_date, 'rls card payoff', grp),
         (a, a_card,               100, 'Income',  current_date, 'rls card payoff', grp);
  perform set_config('sorrel.goal_completion', 'on', true);
  update public.goals set completed_at = null where id = a_debt;
  perform set_config('sorrel.goal_completion', '', true);

  for v_try in
    select * from pg_temp.try_as(b, format('select public.sync_card_goal_completion(%L, array[current_date], true)', a_debt))
  loop
    select coalesce(completed_at::text, 'null') into v_done from public.goals where id = a_debt;
    perform pg_temp.rec('2j card goals', 'sync_card_goal_completion()', 'B syncs A''s followed, paid-off goal',
      'no write: A''s completed_at null', coalesce(v_try.state, 'no error') || '; completed_at ' || v_done,
      v_done = 'null');
  end loop;

  for v_try in
    select * from pg_temp.try_as(b, format('select public.link_goal_to_card(%L, %L)', a_debt, a_card))
  loop
    perform pg_temp.rec('2j card goals', 'link_goal_to_card()', 'B links A''s goal',
      'P0002', coalesce(v_try.state, 'no error'), v_try.state = 'P0002');
  end loop;

  for v_try in
    select * from pg_temp.try_as(b, format('select public.link_goal_to_card(%L, %L)', b_debt, a_card))
  loop
    perform pg_temp.rec('2j card goals', 'link_goal_to_card()', 'B links B''s goal to A''s card',
      'P0002', coalesce(v_try.state, 'no error'), v_try.state = 'P0002');
  end loop;

  for v_try in
    select * from pg_temp.try_as(b, format('select public.unlink_goal_from_card(%L)', a_debt))
  loop
    perform pg_temp.rec('2j card goals', 'unlink_goal_from_card()', 'B unlinks A''s goal',
      'P0002; still following', coalesce(v_try.state, 'no error') || '; ' ||
        (select tracking_method from public.goals where id = a_debt),
      v_try.state = 'P0002' and (select tracking_method from public.goals where id = a_debt) = 'LinkedAccount');
  end loop;

  for v_try in
    select * from pg_temp.try_as(a, format('select public.sync_card_goal_completion(%L, array[current_date], true)', a_debt))
  loop
    select coalesce(completed_at::text, 'null') into v_done from public.goals where id = a_debt;
    perform pg_temp.rec('2j card goals', 'sync_card_goal_completion()', 'control: A syncs A''s own goal',
      'completed_at set', coalesce(v_try.state, 'no error') || '; completed_at ' || v_done, v_done <> 'null');
  end loop;
end
$$;


-- ---------------------------------------------------------------------
-- 2k -- The month recap (migration 71)
--
-- month_story() is security invoker with no user id: RLS alone scopes
-- it. A gets a distinctive $1,234 contribution this month first, so a
-- leak would move B's total. B's call must show exactly B's own logs and
-- goal money (each worked out here as the table owner, filtered to B,
-- by the same rules) and none of A's goals or cards. The control: A's
-- own call names A's goal.
-- ---------------------------------------------------------------------
do $$
declare
  a      uuid := pg_temp.fx('A');
  b      uuid := pg_temp.fx('B');
  v_b    record;
  v_a    record;
  v_logs integer;
  v_total numeric;
  v_leak bigint;
begin
  insert into public.goal_contributions (userid, goalid, amount, date, funding_method)
  values (a, pg_temp.fx('A_goal'), 1234, current_date, 'manual');

  perform pg_temp.become(b);
  select * into v_b from public.month_story(current_date);
  perform pg_temp.unbecome();

  perform pg_temp.become(a);
  select * into v_a from public.month_story(current_date);
  perform pg_temp.unbecome();

  -- The fixtures are written in this transaction, so every row was
  -- created this month; these mirror month_story's filters for B.
  select count(*) into v_logs
    from public.transactions t
   where t.userid = b
     and t.import_id is null
     and (t.transfer_group_id is null or t.transaction_type = 'Expense')
     and t.created_at >= date_trunc('month', current_date::timestamp) at time zone 'UTC';
  perform pg_temp.rec('2k month story', 'month_story()', 'B''s logs are B''s own',
    v_logs::text, coalesce(v_b.logs::text, 'null'), v_b.logs = v_logs and v_logs > 0);

  select coalesce(sum(gm.amount), 0) into v_total
    from public.v_goal_money gm
    join public.goals g on g.id = gm.goalid
   where g.userid = b and g.is_active and g.tracking_method <> 'LinkedAccount'
     and gm.date >= date_trunc('month', current_date::timestamp)::date
     and gm.date <  (date_trunc('month', current_date::timestamp) + interval '1 month')::date;
  perform pg_temp.rec('2k month story', 'month_story()', 'B''s goal total is B''s own money',
    v_total::text, coalesce(v_b.goal_total::text, 'null'), v_b.goal_total = v_total and v_total > 0);

  select count(*) into v_leak
    from (select (e->>'goal_id')::uuid as id from jsonb_array_elements(v_b.goals) e
          union all
          select (e->>'goal_id')::uuid from jsonb_array_elements(v_b.cards) e) x
    join public.goals g on g.id = x.id
   where g.userid <> b;
  perform pg_temp.rec('2k month story', 'month_story()', 'B sees none of A''s goals or cards',
    '0', v_leak::text, v_leak = 0);

  perform pg_temp.rec('2k month story', 'month_story()', 'control: A''s own call names A''s goal',
    'A_goal listed', coalesce(v_a.goals::text, 'null'),
    exists (select 1 from jsonb_array_elements(v_a.goals) e where (e->>'goal_id')::uuid = pg_temp.fx('A_goal')));
end
$$;


-- ---------------------------------------------------------------------
-- 2l -- Goal pace (migration 72)
--
-- goal_pace() is security invoker with no user id: RLS alone scopes it.
-- Each user gets a fresh goal here (the fixture goals carry this month's
-- money, and 2k completes A's), so the expected figures are exact:
-- A's: $600 in each of the two months before this one -> pace 400.
-- B's: $90 and $60 in those months -> pace (90 + 60) / 3 = 50.
-- B's call must list none of A's goals and give B's pace exactly; the
-- control is A's own call giving 400 for A's goal.
-- ---------------------------------------------------------------------
do $$
declare
  a       uuid := pg_temp.fx('A');
  b       uuid := pg_temp.fx('B');
  ga      uuid := gen_random_uuid();
  gb      uuid := gen_random_uuid();
  m1      date := (date_trunc('month', current_date::timestamp) - interval '1 month')::date;
  m2      date := (date_trunc('month', current_date::timestamp) - interval '2 months')::date;
  v_leak  bigint;
  v_b     numeric;
  v_a     numeric;
begin
  insert into public.goals (id, userid, goal_name, goal_type, target_amount, status, tracking_method)
  values (ga, a, 'RLS A pace goal', 'Custom', 100000, 'Active', 'Manual'),
         (gb, b, 'RLS B pace goal', 'Custom', 100000, 'Active', 'Manual');
  insert into public.goal_contributions (userid, goalid, amount, date, funding_method)
  values (a, ga, 600, m1, 'manual'),
         (a, ga, 600, m2, 'manual'),
         (b, gb,  90, m1, 'manual'),
         (b, gb,  60, m2, 'manual');

  perform pg_temp.become(b);
  -- Joined to goals AS B: an id of A's would come back with a null
  -- userid (B can't read it), which "is distinct from b" counts.
  select count(*) filter (where g.userid is distinct from b) into v_leak
    from public.goal_pace() p
    left join public.goals g on g.id = p.goal_id;
  select p.pace into v_b from public.goal_pace() p where p.goal_id = gb;
  perform pg_temp.unbecome();

  perform pg_temp.rec('2l goal pace', 'goal_pace()', 'B lists none of A''s goals',
    '0', v_leak::text, v_leak = 0);
  perform pg_temp.rec('2l goal pace', 'goal_pace()', 'B''s pace is B''s own money',
    '50.00', coalesce(v_b::text, 'null'), v_b = 50);

  perform pg_temp.become(a);
  select p.pace into v_a from public.goal_pace() p where p.goal_id = ga;
  perform pg_temp.unbecome();

  perform pg_temp.rec('2l goal pace', 'goal_pace()', 'control: A''s own call paces A''s goal',
    '400.00', coalesce(v_a::text, 'null'), v_a = 400);
end
$$;


-- The report. Must be the last statement that returns rows.
-- The summary is the LAST row. A run counts as passed only when it says
-- ALL PASS (CLAUDE.md). A run that errors part-way returns no rows at
-- all, so it can never show ALL PASS; a section that silently recorded
-- nothing is named here as missing and also fails the run.
with expected_sections(s) as (
  select unnest(array['1 reads', '2 views', '2c money functions', '2d function grants',
                      '2e waitlist', '2f definer writes', '2g same-bill answers',
                      '2h import', '2i goal links', '2j card goals', '2k month story',
                      '2l goal pace', '3 writes', '4 cross-tenant refs', '5 coverage',
                      '6 same-user writes', '7 trigger oracles', '8 composite FKs'])
),
tally as (
  select (select count(*) from rls_results)                   as total,
         (select count(*) from rls_results where not pass)    as failed,
         (select string_agg(e.s, ', ' order by e.s)
            from expected_sections e
           where not exists (select 1 from rls_results r where r.section = e.s)) as missing
)
select section, object, check_ as check, expected, actual, pass
  from (select seq, section, object, check_, expected, actual, pass
          from rls_results
        union all
        select 2147483647, 'SUMMARY', 'all sections', 'every row true, every section present',
               'ALL PASS',
               t.total || ' rows, ' || t.failed || ' false'
                 || coalesce(', missing sections: ' || t.missing, '')
                 || ' -- ' || case when t.failed = 0 and t.missing is null then 'ALL PASS' else 'NOT PASSED' end,
               t.failed = 0 and t.missing is null
          from tally t) x
 order by seq;

rollback;
