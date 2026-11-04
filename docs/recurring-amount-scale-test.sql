-- =====================================================================
-- Schedule amounts are numeric(12,2) (migration 61)
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/recurring-amount-scale-test.sql
--
-- One row per assertion; clean only when every `pass` is true. One
-- throwaway user, one transaction, ROLLBACK. Cleanup check (must be 0):
--   select count(*) from auth.users where email like 'sc-test-%@example.invalid';
--
--   1  amount and next_amount are numeric(12,2).
--   2  A third decimal place is rounded on write, as transactions.amount
--      rounds it -- so the schedule and its confirmed transaction agree.
--   3  Every money value v_recurring_amounts / v_upcoming_recurring return
--      has scale 2: a fixed amount, a card owing nothing, a statement
--      amount, an estimate.
--   4  The three recreated views carry production's ACL, and anon can't
--      read them.
--   5  Their comments came back (1 on v_recurring_amounts, 4 on
--      v_upcoming_recurring's columns).
-- =====================================================================

begin;

create temp table sc_results (
  seq      serial primary key,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
grant insert, select on sc_results to authenticated;
grant usage on sequence sc_results_seq_seq to authenticated;

create function pg_temp.rec(p_check text, p_expected text, p_actual text) returns void
language sql as $$
  insert into sc_results (check_, expected, actual, pass)
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

-- 1, 4, 5: catalog, as the migration role --------------------------------
select pg_temp.rec('1 ' || a.attname || ' is numeric(12,2)', 'numeric(12,2)', format_type(a.atttypid, a.atttypmod))
  from pg_attribute a
 where a.attrelid = 'public.recurring_transactions'::regclass and a.attname in ('amount', 'next_amount');

select pg_temp.rec('4 ' || c.relname || ' ACL',
                   'postgres=arwdDxtm/postgres authenticated=rDxtm/postgres service_role=Dxtm/postgres',
                   array_to_string(c.relacl, ' '))
  from pg_class c
 where c.relnamespace = 'public'::regnamespace
   and c.relname in ('v_recurring_amounts', 'v_upcoming_recurring', 'v_integrity_issues');

select pg_temp.rec('4 anon cannot read ' || v, 'false', has_table_privilege('anon', 'public.' || v, 'select')::text)
  from unnest(array['v_recurring_amounts', 'v_upcoming_recurring', 'v_integrity_issues']) v;

select pg_temp.rec('4 ' || v || ' is security_invoker', 'security_invoker=true',
                   array_to_string((select reloptions from pg_class where oid = ('public.' || v)::regclass), ','))
  from unnest(array['v_recurring_amounts', 'v_upcoming_recurring', 'v_integrity_issues']) v;

select pg_temp.rec('5 comments on v_recurring_amounts', '1',
                   (select count(*) from pg_description where objoid = 'public.v_recurring_amounts'::regclass)::text);
select pg_temp.rec('5 comments on v_upcoming_recurring', '4',
                   (select count(*) from pg_description where objoid = 'public.v_upcoming_recurring'::regclass)::text);

-- 2, 3: as a user ------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('ffffffff-ffff-4fff-8fff-ffffffffffff', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'sc-test-f@example.invalid', '{}'::jsonb,
        '{"first_name": "Sc", "last_name": "Test"}'::jsonb, now(), now());

do $$
declare
  u        constant uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  chk      constant uuid := 'ffffffff-0000-4000-8000-000000000001';
  card     constant uuid := 'ffffffff-0000-4000-8000-000000000002';
  rent_s   constant uuid := 'ffffffff-0000-4000-8000-000000000011';
  card_s   constant uuid := 'ffffffff-0000-4000-8000-000000000012';
  stmt_s   constant uuid := 'ffffffff-0000-4000-8000-000000000013';
  odd_s    constant uuid := 'ffffffff-0000-4000-8000-000000000014';
  var_s    constant uuid := 'ffffffff-0000-4000-8000-000000000015';
  rent_cat uuid;
  util_cat uuid;
  state    text;
begin
  select id into rent_cat from public.categories where userid = u and category_name = 'Rent';
  select id into util_cat from public.categories where userid = u and category_name = 'Utilities';

  perform pg_temp.become(u);

  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (chk,  u, 'SC checking', 'Checking',    1000, current_date - 30),
         (card, u, 'SC card',     'Credit Card', 0,    current_date - 30);

  insert into public.recurring_transactions
    (id, userid, accountid, categoryid, description, amount, frequency,
     next_run_date, start_date, next_due_date)
  values (rent_s, u, chk, rent_cat, 'Rent', 1850,   'Monthly', current_date + 5, current_date + 5, current_date + 5),
         (odd_s,  u, chk, rent_cat, 'Odd',  12.345, 'Monthly', current_date + 6, current_date + 6, current_date + 6);
  insert into public.recurring_transactions
    (id, userid, accountid, categoryid, description, amount, frequency,
     next_run_date, start_date, next_due_date, amount_is_variable)
  values (var_s, u, chk, util_cat, 'Power', 60, 'Monthly', current_date + 7, current_date + 7, current_date + 7, true);
  -- Card payments: one estimated from the balance (the card owes nothing),
  -- one with a statement amount entered.
  insert into public.recurring_transactions
    (id, userid, accountid, to_accountid, description, amount, frequency,
     next_run_date, start_date, next_due_date, amount_is_variable, statement_day)
  values (card_s, u, chk, card, 'Card', 0, 'Monthly', current_date + 8, current_date + 8, current_date + 8, true, 1);
  insert into public.recurring_transactions
    (id, userid, accountid, to_accountid, description, amount, frequency,
     next_run_date, start_date, next_due_date, amount_is_variable, statement_day,
     next_amount, next_amount_confirmed_at)
  values (stmt_s, u, chk, card, 'Card 2', 0, 'Monthly', current_date + 9, current_date + 9, current_date + 9, true, 1,
          240, now());

  -- 2 -----------------------------------------------------------------
  select amount::text into state from public.recurring_transactions where id = odd_s;
  perform pg_temp.rec('2 12.345 is stored as 12.35, as transactions.amount would store it', '12.35', state);
  select amount::text into state from public.recurring_transactions where id = rent_s;
  perform pg_temp.rec('2 1850 is stored as 1850.00', '1850.00', state);

  -- 3 -----------------------------------------------------------------
  select amount::text into state from public.v_recurring_amounts where recurring_id = rent_s;
  perform pg_temp.rec('3 fixed amount', '1850.00', state);
  select amount::text into state from public.v_recurring_amounts where recurring_id = card_s;
  perform pg_temp.rec('3 card owing nothing', '0.00', state);
  select card_balance_owed::text into state from public.v_recurring_amounts where recurring_id = card_s;
  perform pg_temp.rec('3 card_balance_owed', '0.00', state);
  select amount::text into state from public.v_recurring_amounts where recurring_id = stmt_s;
  perform pg_temp.rec('3 statement amount', '240.00', state);
  select amount::text || ' / ' || amount_high::text into state from public.v_recurring_amounts where recurring_id = var_s;
  perform pg_temp.rec('3 variable estimate and its high end', '60.00 / 60.00', state);
  select next_amount::text into state from public.v_upcoming_recurring where recurring_id = stmt_s;
  perform pg_temp.rec('3 v_upcoming_recurring.next_amount', '240.00', state);
  select count(*)::text into state from public.v_upcoming_recurring
   where userid = u
     and (scale(amount) <> 2 or scale(amount_high) <> 2 or scale(amount_low) <> 2
          or scale(card_balance_owed) <> 2 or scale(next_amount) <> 2);
  perform pg_temp.rec('3 no money value in v_upcoming_recurring at another scale', '0', state);

  perform pg_temp.unbecome();
end
$$;

select seq, check_, expected, actual, pass from sc_results order by seq;

rollback;
