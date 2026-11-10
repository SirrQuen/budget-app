-- =====================================================================
-- Budget carry-forward and uniqueness test (migration 63)
--
-- Run against sorrel-dev after any change to budgets, its constraint,
-- budget_progress_for_month() or the budget status helpers:
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/budget-carry-forward-test.sql
--
-- One row per assertion (section, check, expected, actual, pass). A run
-- is clean only when every `pass` is true.
--
-- Self-cleaning: ONE transaction ending in ROLLBACK, one throwaway user,
-- nothing committed. Cleanup check after a run (must be 0):
--   select count(*) from auth.users where email like 'budget-test-%@example.invalid';
--
-- Sections
--   1  Derived     a month with no rows shows each category's most recent
--                  earlier amount, per category; reading writes nothing
--   2  Edit        setting one carried category writes one row, for that
--                  month; the others keep carrying
--   3  Unique      a second row for one (userid, month, category) is
--                  refused by the database
--   4  Figures     the helpers give the view's figures; a $0 budget is a
--                  budget (On Track), never "Unbudgeted"
--   5  Stop        a tombstone stops a category from its month on, carries,
--                  never shows as a budget, and an amount starts it again
-- =====================================================================

begin;

create temp table budget_results (
  seq      serial primary key,
  section  text not null,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
grant insert on budget_results to authenticated;
grant usage on sequence budget_results_seq_seq to authenticated;

create function pg_temp.rec(p_section text, p_check text, p_expected text, p_actual text)
returns void language sql as $$
  insert into budget_results (section, check_, expected, actual, pass)
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

-- One month's figures as "Category=amount[<carried_from]" in name order.
create function pg_temp.month_view(p_month date) returns text language sql as $$
  select string_agg(category_name || '=' || budget_amount
                    || coalesce('<' || to_char(carried_from, 'YYYY-MM'), ''),
                    ',' order by category_name)
    from public.budget_progress_for_month(p_month)
$$;

create function pg_temp.cat(p_name text) returns uuid language sql as $$
  select id from public.categories
   where userid = 'b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6' and category_name = p_name
$$;


-- ---------------------------------------------------------------------
-- Fixture: one user (the signup trigger makes the default categories)
--   Groceries  $600 in August, $650 in October
--   Dining      $0  in October (a deliberate "not this month")
--   Fuel       $120 in August, then archived
-- ---------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'budget-test-a@example.invalid', '{}'::jsonb,
        '{"first_name": "Budget"}'::jsonb, now(), now());

-- Three expense categories the fixture owns outright, named so the
-- result strings are stable whatever the default set holds. Inserted as
-- the owner: in the app the signup trigger owns category creation.
insert into public.categories (userid, groupid, category_name, category_type)
select 'b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6', g.id, v.name, 'Expense'
  from (values ('T Groceries'), ('T Dining'), ('T Fuel')) as v(name)
 cross join lateral (select id from public.category_groups
                      where userid = 'b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6' limit 1) g;

select pg_temp.become('b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6');

insert into public.budgets (userid, categoryid, budget_month, budget_amount) values
  ('b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6', pg_temp.cat('T Groceries'), date '2026-08-01', 600),
  ('b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6', pg_temp.cat('T Fuel'),      date '2026-08-01', 120),
  ('b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6', pg_temp.cat('T Groceries'), date '2026-10-01', 650),
  ('b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6', pg_temp.cat('T Dining'),    date '2026-10-01', 0);


-- ---------------------------------------------------------------------
-- 1. Derived
-- ---------------------------------------------------------------------
select pg_temp.rec('1 derived', 'a skipped month (September) carries August, per category',
  'T Fuel=120.00<2026-08,T Groceries=600.00<2026-08', pg_temp.month_view(date '2026-09-01'));

select pg_temp.rec('1 derived', 'October shows its own rows; $0 is a budget',
  'T Dining=0.00,T Fuel=120.00<2026-08,T Groceries=650.00', pg_temp.month_view(date '2026-10-01'));

select pg_temp.rec('1 derived', 'a fresh month (December) carries each category''s latest',
  'T Dining=0.00<2026-10,T Fuel=120.00<2026-08,T Groceries=650.00<2026-10',
  pg_temp.month_view(date '2026-12-01'));

select pg_temp.rec('1 derived', 'a carried row has no budget_id: nothing exists for that month',
  '3', (select count(*)::text from public.budget_progress_for_month(date '2026-12-01')
         where budget_id is null));

select pg_temp.rec('1 derived', 'reading every month wrote no rows',
  '4', (select count(*)::text from public.budgets));

-- An archived category stops carrying; its own month still shows it.
update public.categories set is_active = false where id = pg_temp.cat('T Fuel');
select pg_temp.rec('1 derived', 'archived category: no longer carried',
  'T Dining=0.00<2026-10,T Groceries=650.00<2026-10', pg_temp.month_view(date '2026-12-01'));
select pg_temp.rec('1 derived', 'archived category: its own month still shows',
  'T Fuel=120.00,T Groceries=600.00', pg_temp.month_view(date '2026-08-01'));

select pg_temp.rec('1 derived', 'before any budget: nothing',
  'null', pg_temp.month_view(date '2026-07-01'));


-- ---------------------------------------------------------------------
-- 2. Edit: the app's write (setBudgetForMonth) is this upsert
-- ---------------------------------------------------------------------
insert into public.budgets (userid, categoryid, budget_month, budget_amount)
values ('b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6', pg_temp.cat('T Groceries'), date '2026-12-01', 700)
on conflict (userid, budget_month, categoryid) do update set budget_amount = excluded.budget_amount;

select pg_temp.rec('2 edit', 'one carried category edited: exactly one row written, for that month',
  '5 1', (select count(*)::text || ' ' ||
                 (select count(*) from public.budgets where budget_month = date '2026-12-01')::text
            from public.budgets));
select pg_temp.rec('2 edit', 'the edited one is its own; the others keep carrying',
  'T Dining=0.00<2026-10,T Groceries=700.00', pg_temp.month_view(date '2026-12-01'));
select pg_temp.rec('2 edit', 'and January carries the new amount',
  'T Dining=0.00<2026-10,T Groceries=700.00<2026-12', pg_temp.month_view(date '2027-01-01'));

-- The same write again (a double submit) updates, never duplicates.
insert into public.budgets (userid, categoryid, budget_month, budget_amount)
values ('b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6', pg_temp.cat('T Groceries'), date '2026-12-01', 720)
on conflict (userid, budget_month, categoryid) do update set budget_amount = excluded.budget_amount;
select pg_temp.rec('2 edit', 'the same write twice: still one row, latest amount',
  '1 720.00', (select count(*)::text || ' ' || max(budget_amount)::text from public.budgets
                where budget_month = date '2026-12-01'));


-- ---------------------------------------------------------------------
-- 3. Unique
-- ---------------------------------------------------------------------
select pg_temp.rec('3 unique', 'a second row for one category and month: refused by the database',
  '23505', pg_temp.sqlstate_of(format(
    'insert into public.budgets (userid, categoryid, budget_month, budget_amount) values (%L, %L, %L, 5)',
    'b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6', pg_temp.cat('T Groceries'), '2026-10-01')));
select pg_temp.rec('3 unique', 'moving a row onto another''s category and month: refused',
  '23505', pg_temp.sqlstate_of(format(
    'update public.budgets set budget_month = %L where categoryid = %L and budget_month = %L',
    '2026-10-01', pg_temp.cat('T Groceries'), '2026-08-01')));


-- ---------------------------------------------------------------------
-- 4. Same: the view's figures through the helpers
-- ---------------------------------------------------------------------
with a as (
  insert into public.accounts (userid, account_name, account_type, opening_balance, opening_date)
  values ('b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6', 'T Checking', 'Checking', 1000, date '2026-07-01')
  returning id
)
insert into public.transactions (userid, accountid, categoryid, description, amount,
                                 transaction_type, transaction_date)
select 'b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6', a.id, pg_temp.cat('T Groceries'), 'groceries',
       540, 'Expense', date '2026-10-12'
  from a;

-- $540 of $650: 83.1%, near the limit. $0 with nothing spent: as before.
select pg_temp.rec('4 same', 'v_budget_vs_actual: figures for a spent budget',
  '540.00 110.00 83.1 Near Limit 2',
  (select concat_ws(' ', actual_spend, remaining, pct_used, status, status_rank)
     from public.v_budget_vs_actual
    where category_id = pg_temp.cat('T Groceries') and budget_month = date '2026-10-01'));
select pg_temp.rec('4 same', 'a $0 budget with nothing spent is on track, not "Unbudgeted"',
  'On Track 1 null', (select concat_ws(' ', status, status_rank, coalesce(pct_used::text, 'null'))
                         from public.v_budget_vs_actual
                        where category_id = pg_temp.cat('T Dining') and budget_month = date '2026-10-01'));
select pg_temp.rec('4 same', 'the month function agrees with the view on every own row',
  'true', (select (count(*) = 0)::text from (
             select category_id, actual_spend, remaining, pct_used, status, status_rank
               from public.budget_progress_for_month(date '2026-10-01') where carried_from is null
             except
             select category_id, actual_spend, remaining, pct_used, status, status_rank
               from public.v_budget_vs_actual where budget_month = date '2026-10-01') d));
select pg_temp.rec('4 same', 'a carried budget counts the viewed month''s spend, not its source month''s',
  '0.00 650.00 2026-10-01', (select concat_ws(' ', actual_spend, remaining, carried_from)
                               from public.budget_progress_for_month(date '2026-11-01')
                              where category_id = pg_temp.cat('T Groceries')));

-- $8 at the restaurant against October's $0 budget: over, which is the fact.
insert into public.transactions (userid, accountid, categoryid, description, amount,
                                 transaction_type, transaction_date)
select 'b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6', a.id, pg_temp.cat('T Dining'), 'lunch', 8, 'Expense', date '2026-10-20'
  from public.accounts a where a.account_name = 'T Checking';
select pg_temp.rec('4 same', 'a $0 budget with spending is over',
  'Over 3', (select concat_ws(' ', status, status_rank) from public.v_budget_vs_actual
              where category_id = pg_temp.cat('T Dining') and budget_month = date '2026-10-01'));


-- ---------------------------------------------------------------------
-- 5. Stop: the app's write (stopBudgetingForMonth) is this upsert
-- ---------------------------------------------------------------------
insert into public.budgets (userid, categoryid, budget_month, budget_amount, not_budgeted)
values ('b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6', pg_temp.cat('T Groceries'), date '2027-02-01', 0, true)
on conflict (userid, budget_month, categoryid)
do update set budget_amount = excluded.budget_amount, not_budgeted = excluded.not_budgeted;

select pg_temp.rec('5 stop', 'January still carries December''s amount',
  'T Dining=0.00<2026-10,T Groceries=720.00<2026-12', pg_temp.month_view(date '2027-01-01'));
select pg_temp.rec('5 stop', 'from February: not budgeted, and no earlier amount comes back',
  'T Dining=0.00<2026-10', pg_temp.month_view(date '2027-02-01'));
select pg_temp.rec('5 stop', 'the tombstone carries: still not budgeted in May',
  'T Dining=0.00<2026-10', pg_temp.month_view(date '2027-05-01'));
select pg_temp.rec('5 stop', 'a tombstone is never a budget in the view',
  '0', (select count(*)::text from public.v_budget_vs_actual where budget_month = date '2027-02-01'));
select pg_temp.rec('5 stop', 'a tombstone with an amount: refused',
  '23514', pg_temp.sqlstate_of(format(
    'insert into public.budgets (userid, categoryid, budget_month, budget_amount, not_budgeted) values (%L, %L, %L, 5, true)',
    'b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6', pg_temp.cat('T Dining'), '2027-03-01')));

-- Setting an amount again in April (setBudgetForMonth) starts it again.
insert into public.budgets (userid, categoryid, budget_month, budget_amount, not_budgeted)
values ('b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6', pg_temp.cat('T Groceries'), date '2027-04-01', 610, false)
on conflict (userid, budget_month, categoryid)
do update set budget_amount = excluded.budget_amount, not_budgeted = excluded.not_budgeted;
select pg_temp.rec('5 stop', 'an amount set again starts it from that month',
  'T Dining=0.00<2026-10,T Groceries=610.00<2027-04', pg_temp.month_view(date '2027-05-01'));

-- Stopping in a month that already has its own row replaces that row.
insert into public.budgets (userid, categoryid, budget_month, budget_amount, not_budgeted)
values ('b0d6b0d6-b0d6-4b0d-8b0d-b0d6b0d6b0d6', pg_temp.cat('T Groceries'), date '2027-04-01', 0, true)
on conflict (userid, budget_month, categoryid)
do update set budget_amount = excluded.budget_amount, not_budgeted = excluded.not_budgeted;
select pg_temp.rec('5 stop', 'stopping a month with its own row: one row, now a tombstone',
  '1 true', (select count(*)::text || ' ' || bool_and(not_budgeted)::text from public.budgets
              where categoryid = pg_temp.cat('T Groceries') and budget_month = date '2027-04-01'));

select pg_temp.unbecome();


-- The report. Must be the last statement that returns rows.
select section, check_ as check, expected, actual, pass
  from budget_results
 order by seq;

rollback;
