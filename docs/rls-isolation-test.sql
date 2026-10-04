-- =====================================================================
-- RLS isolation test
--
-- Run against the linked project after any migration that touches
-- tables, views, grants, policies or functions:
--
--   npx supabase@latest db query --linked -f docs/rls-isolation-test.sql
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
--   5  Coverage   every public table/view is tested here or exempted
--   2d Function grants (Phase 7)
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

-- Run a write as p_user. Returns rows affected, or the error it raised.
create function pg_temp.try_as(p_user uuid, p_sql text,
  out n bigint, out state text, out msg text)
language plpgsql as $$
begin
  perform pg_temp.become(p_user);
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
                    ('recur','09'), ('sub','0a')) as v(k, n)
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

    insert into public.budgets (id, userid, categoryid, budget_amount, budget_month)
    values (pg_temp.fx(u || '_budget'), uid, pg_temp.fx(u || '_groceries'), 100,
            date_trunc('month', current_date)::date);

    insert into public.goals (id, userid, goal_name, goal_type, target_amount, status, tracking_method)
    values (pg_temp.fx(u || '_goal'), uid, 'RLS ' || u || ' goal', 'Custom', 500, 'Active', 'Manual');

    insert into public.goal_contributions (id, goalid, amount, date, funding_method)
    values (pg_temp.fx(u || '_contrib'), pg_temp.fx(u || '_goal'), 50, current_date, 'manual');

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
      ('1 reads', 'recurring_transactions', format('userid = %L', a),                            format('userid <> %L', b)),
      ('1 reads', 'settings',               format('userid = %L', a),                            format('userid <> %L', b)),
      ('1 reads', 'subscriptions',          format('userid = %L', a),                            format('userid <> %L', b)),
      ('1 reads', 'transactions',           format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_account_balances',     format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_budget_vs_actual',     format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_category_activity',    format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_category_spending',    format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_daily_cashflow',       format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_dashboard_kpis',       format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_goal_progress',        format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_goals_summary',        format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_integrity_issues',     format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_investment_holdings',  format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_monthly_cashflow',     format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_net_worth',            format('userid = %L', a),                            format('userid <> %L', b)),
      ('2 views', 'v_portfolio_summary',    format('userid = %L', a),                            format('userid <> %L', b)),
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
      ('investments',            'id', pg_temp.fx('A_invest'),   pg_temp.fx('B_invest'),   'userid', 'ticker = ''HACK'''),
      ('notifications',          'id', pg_temp.fx('A_notif'),    pg_temp.fx('B_notif'),    'userid', 'is_read = true'),
      ('profiles',               'id', a,                        b,                        'id',     'first_name = ''rls-b-was-here'''),
      ('recurring_transactions', 'id', pg_temp.fx('A_recur'),    pg_temp.fx('B_recur'),    'userid', 'description = ''rls-b-was-here'''),
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
      ('goal_contributions',     format('insert into public.goal_contributions (goalid, amount, date, funding_method) values (%L, 1, current_date, ''manual'')', pg_temp.fx('A_goal'))),
      ('goals',                  format('insert into public.goals (userid, goal_name, goal_type, target_amount) values (%L, ''rls'', ''Custom'', 1)', a)),
      ('investments',            format('insert into public.investments (userid, accountid, ticker, shares, average_cost, asset_type) values (%L, %L, ''RLS2'', 1, 1, ''Stock'')', a, pg_temp.fx('B_invacct'))),
      ('notifications',          format('insert into public.notifications (userid, title, message, notification_type) values (%L, ''rls'', ''rls'', ''info'')', a)),
      ('profiles',               format('insert into public.profiles (id, first_name, last_name) values (%L, ''rls'', ''rls'')', a)),
      ('recurring_transactions', format('insert into public.recurring_transactions (userid, accountid, categoryid, description, amount, frequency, next_run_date, next_due_date) values (%L, %L, %L, ''rls'', 1, ''Monthly'', current_date + 5, current_date + 5)', a, pg_temp.fx('B_acct'), pg_temp.fx('B_rent'))),
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
        format('insert into public.goal_contributions (goalid, transactionid, amount, date, funding_method) values (%L, %L, 1, current_date, ''transaction'')', pg_temp.fx('B_goal'), pg_temp.fx('A_txn')))
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
      ('goals', 'INSERT, own linked account', 1,
        format('insert into public.goals (userid, goal_name, goal_type, target_amount, tracking_method, accountid) values (%L, ''rls ok'', ''Custom'', 100, ''LinkedAccount'', %L)', a, pg_temp.fx('A_acct'))),
      ('goals', 'UPDATE own goal', 1,
        format('update public.goals set goal_name = ''rls edited'' where id = %L', pg_temp.fx('A_goal'))),
      ('goal_contributions', 'INSERT manual, transactionid null', 1,
        format('insert into public.goal_contributions (goalid, amount, date, funding_method) values (%L, 10, current_date, ''manual'')', pg_temp.fx('A_goal'))),
      ('goal_contributions', 'INSERT from own transaction', 1,
        format('insert into public.goal_contributions (goalid, transactionid, amount, date, funding_method) values (%L, %L, 30, current_date, ''transaction'')', pg_temp.fx('A_goal'), pg_temp.fx('A_txn'))),
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
        when r.relname in (select object from rls_results where section in ('1 reads', '2 views'))
          then 'tested' || case when r.relkind in ('r', 'p') and not r.relrowsecurity then ', but RLS DISABLED' else '' end
        else 'NOT TESTED'
      end,
      r.relname = 'bank_holidays'
        or (r.relname in (select object from rls_results where section in ('1 reads', '2 views'))
            and (r.relkind not in ('r', 'p') or r.relrowsecurity)));
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
      -- Trigger functions: closed in migration 36 so nobody has to
      -- re-reason about them.
      ('public.handle_new_user()',                               'anon',          false),
      ('public.handle_new_user()',                               'authenticated', false),
      ('public.enforce_category_type()',                         'anon',          false),
      ('public.enforce_category_type()',                         'authenticated', false),
      ('public.enforce_recurring_variability_scope()',           'anon',          false),
      ('public.enforce_recurring_variability_scope()',           'authenticated', false)
    ) as t(fn, role, expected)
  loop
    v_actual := has_function_privilege(v_check.role, v_check.fn::regprocedure, 'execute');
    perform pg_temp.rec('2d function grants', v_check.fn, v_check.role || ' EXECUTE',
      v_check.expected::text, v_actual::text, v_actual = v_check.expected);
  end loop;
end
$$;


-- The report. Must be the last statement that returns rows.
select section, object, check_ as check, expected, actual, pass
  from rls_results
 order by seq;

rollback;
