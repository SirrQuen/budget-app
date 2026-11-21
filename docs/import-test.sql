-- =====================================================================
-- CSV import test (migration 68, docs/Import-CSV.md)
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/import-test.sql
--
-- It writes, then rolls back, so it isn't --read-only and the CLI asks
-- for confirmation: Matt runs it. Read the Target line first.
--
-- Returns one row per assertion; a run is clean only when every `pass`
-- is true. Self-cleaning, same as docs/rls-isolation-test.sql and
-- docs/same-bill-test.sql: two throwaway users, one transaction,
-- ROLLBACK. Cleanup check (must be 0):
--   select count(*) from auth.users where email like 'ic-test-%@example.invalid';
--
-- What only the database can show (the parsing, the amounts, the dates,
-- the sign question and the duplicate flag are TypeScript, pinned by
-- lib/importCsv.test.ts and lib/importReview.test.ts):
--
-- A run counts as passed only when its LAST row, SUMMARY, says ALL PASS.
-- Transfers and per-row categories (migration 76) are in
-- docs/import-transfers-test.sql.
--
--   1  import_preview() describes each date from counts_in_balance():
--      counts / before_anchor / future.
--   2  After a real import the balance equals the preview EXACTLY, for
--      both pre-anchor answers; undoing it leaves every balance, the
--      Spendable Cash figure and the row counts exactly as before.
--   3  A forced failure on row 70 of 140 writes zero rows and no import.
--   4  A row before the balance date with no answer refuses the batch
--      (SRA01) and writes nothing.
--   5  A retry with the same idempotency key writes nothing twice.
--   6  Every field is validated again on the server.
--   7  "Yes, same bill" on a past-dated row: linked, the schedule stepped,
--      the answer recorded -- all or none; a stale claim or a later bad
--      row leaves no link, no cursor move, no rows; undo puts the
--      occurrence back. "No, keep both" is remembered the way item 4
--      remembers it.
--   8  Another user's account, import and dates are refused (P0002).
--   9  imports can't be written directly; deleting an import row that
--      still has transactions is refused (RESTRICT, never CASCADE).
--  10  list_imports() counts what remains and what was edited since.
--  11  confirm_same_bill() (item 4) still refuses a past-dated entry.
--  12  delete_own_account() leaves no import behind.
--
-- A failed call inside a plpgsql exception block is rolled back as a
-- unit -- the same guarantee PostgREST gives each request, which is how
-- the app calls these functions.
-- =====================================================================

begin;

create temp table ic_results (
  seq      serial primary key,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
grant insert, select on ic_results to authenticated;
grant usage on sequence ic_results_seq_seq to authenticated;

create function pg_temp.rec(p_check text, p_expected text, p_actual text) returns void
language sql as $$
  insert into ic_results (check_, expected, actual, pass)
  values (p_check, p_expected, coalesce(p_actual, '<null>'), coalesce(p_expected = p_actual, false))
$$;

-- Money compares as numbers, not text: numeric(12,2) and a computed figure
-- print with different scales.
create function pg_temp.rec_num(p_check text, p_expected numeric, p_actual numeric) returns void
language sql as $$
  insert into ic_results (check_, expected, actual, pass)
  values (p_check, p_expected::text, coalesce(p_actual::text, '<null>'), coalesce(p_expected = p_actual, false))
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

-- The SQLSTATE a statement fails with, or 'ok'. The statement's own
-- effects are rolled back with it.
create function pg_temp.state_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end
$$;

-- n rows of one kind, as import_transactions() takes them.
create function pg_temp.rows_json(p_first int, p_count int, p_date date, p_type text,
                                  p_cents bigint, p_cat uuid) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'row', g, 'date', p_date::text, 'cents', p_cents + g, 'type', p_type,
           'description', 'ic row ' || g, 'categoryid', p_cat) order by g), '[]'::jsonb)
    from generate_series(p_first, p_first + p_count - 1) g
$$;

create function pg_temp.balance_of(p_account uuid) returns numeric language sql as $$
  select balance from public.v_account_balances where account_id = p_account
$$;

insert into auth.users (id, instance_id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'ic-test-e@example.invalid', '{}'::jsonb,
        '{"first_name": "Ic", "last_name": "Test"}'::jsonb, now(), now()),
       ('ffffffff-ffff-4fff-8fff-ffffffffffff', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'ic-test-f@example.invalid', '{}'::jsonb,
        '{"first_name": "Ic", "last_name": "Other"}'::jsonb, now(), now());

do $$
declare
  u        constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  v        constant uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  chk      constant uuid := 'eeeeeeee-0000-4000-8000-000000000001';
  sav      constant uuid := 'eeeeeeee-0000-4000-8000-000000000002';
  vchk     constant uuid := 'ffffffff-0000-4000-8000-000000000001';
  rent_s   constant uuid := 'eeeeeeee-0000-4000-8000-000000000011';
  key1     constant uuid := 'eeeeeeee-0000-4000-8000-0000000000a1';
  d_count  constant date := current_date - 3;    -- after the balance date: counts
  d_before constant date := current_date - 20;   -- before it: depends on the answer
  d_future constant date := current_date + 5;    -- after today: counts on its date
  d0       constant date := current_date - 2;    -- the occurrence waiting in the queue
  d1       date := (current_date - 2 + interval '1 month')::date;  -- the cycle after it
  rent_cat uuid;
  pay_cat  uuid;
  all_rows jsonb;
  bal0     numeric;
  cash0    numeric;
  bal_after numeric;
  exp_added numeric;
  exp_incl  numeric;
  imp      uuid;
  imp2     uuid;
  vimp     uuid;
  n        int;
  st       text;
  r        record;
  txs0     int;
begin
  select id into rent_cat from public.categories where userid = u and category_name = 'Rent';
  select id into pay_cat  from public.categories where userid = u and category_name = 'Paychecks/Salary';

  perform pg_temp.become(u);
  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (chk, u, 'IC checking', 'Checking', 1000, current_date - 10),
         (sav, u, 'IC savings',  'Savings',  0,    current_date - 10);
  perform pg_temp.unbecome();

  perform pg_temp.become(v);
  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (vchk, v, 'IC other checking', 'Checking', 500, current_date - 10);
  perform pg_temp.unbecome();

  -- 38 rows: 20 that count by date, 13 before the balance date (10 spent,
  -- 3 received), 5 dated after today.
  all_rows := pg_temp.rows_json(1, 20, d_count, 'Expense', 1000, rent_cat)
           || pg_temp.rows_json(21, 10, d_before, 'Expense', 500, rent_cat)
           || pg_temp.rows_json(31, 3, d_before, 'Income', 7000, pay_cat)
           || pg_temp.rows_json(34, 5, d_future, 'Expense', 200, rent_cat);

  perform pg_temp.become(u);
  bal0  := pg_temp.balance_of(chk);
  cash0 := public.spendable_cash_balance();
  txs0  := (select count(*) from public.transactions where accountid = chk);

  -- 1 -----------------------------------------------------------------
  perform pg_temp.rec('1 preview: a date after the balance date', 'counts true true',
    (select treatment || ' ' || counts_if_included || ' ' || counts_if_added
       from public.import_preview(chk, array[d_count])));
  perform pg_temp.rec('1 preview: a date before it depends on the answer', 'before_anchor false true',
    (select treatment || ' ' || counts_if_included || ' ' || counts_if_added
       from public.import_preview(chk, array[d_before])));
  perform pg_temp.rec('1 preview: a date after today counts on its date, not yet', 'future false false',
    (select treatment || ' ' || counts_if_included || ' ' || counts_if_added
       from public.import_preview(chk, array[d_future])));
  perform pg_temp.rec('1 preview: distinct dates, once each', '3',
    (select count(*)::text from public.import_preview(chk, array[d_count, d_count, d_before, d_future, null])));

  -- What the preview says each answer moves the balance by, in cents,
  -- summed here from the rows and the database's flags.
  select coalesce(sum(case when e.t = 'Income' then e.c else -e.c end) filter (where pv.counts_if_added), 0),
         coalesce(sum(case when e.t = 'Income' then e.c else -e.c end) filter (where pv.counts_if_included), 0)
    into exp_added, exp_incl
    from (select (j->>'date')::date d, (j->>'cents')::bigint c, j->>'type' t
            from jsonb_array_elements(all_rows) j) e
    join public.import_preview(chk, (select array_agg(distinct (j->>'date')::date) from jsonb_array_elements(all_rows) j)) pv
      on pv.transaction_date = e.d;

  -- 2 -----------------------------------------------------------------
  select out_import_id into imp from public.import_transactions(chk, all_rows, true, null);
  bal_after := pg_temp.balance_of(chk);
  perform pg_temp.rec_num('2 "No, add them": the balance moves by exactly what the preview said',
    bal0 + exp_added / 100, bal_after);
  perform pg_temp.rec('2 ... every row carries the import', '38',
    (select count(*)::text from public.transactions where import_id = imp));
  perform pg_temp.rec('2 ... and one import row says how many', '38 ' || chk,
    (select row_count || ' ' || accountid from public.imports where id = imp));
  perform pg_temp.rec('2 ... the answer is on each pre-balance row, as if answered one by one', '13',
    (select count(*)::text from public.transactions
      where import_id = imp and counts_despite_anchor is true and anchor_answer_set_at is not null));
  perform pg_temp.rec('2 ... a row the date already counts carries no answer', '25',
    (select count(*)::text from public.transactions
      where import_id = imp and counts_despite_anchor is null and anchor_answer_set_at is null));

  select out_deleted into n from public.undo_import(imp);
  perform pg_temp.rec('2 undo: every row goes', '38', n::text);
  perform pg_temp.rec_num('2 undo: the balance is exactly as before', bal0, pg_temp.balance_of(chk));
  perform pg_temp.rec_num('2 undo: Spendable Cash is exactly as before', cash0, public.spendable_cash_balance());
  perform pg_temp.rec('2 undo: the row count is exactly as before', txs0::text,
    (select count(*)::text from public.transactions where accountid = chk));
  perform pg_temp.rec('2 undo: the import itself is gone', '0',
    (select count(*)::text from public.imports where id = imp));

  select out_import_id into imp from public.import_transactions(chk, all_rows, false, null);
  perform pg_temp.rec_num('2 "Yes, already counted": the balance moves by exactly what the preview said',
    bal0 + exp_incl / 100, pg_temp.balance_of(chk));
  perform pg_temp.rec('2 ... rows before the date are stored as already counted', '13',
    (select count(*)::text from public.transactions where import_id = imp and counts_despite_anchor is false));
  perform public.undo_import(imp);
  perform pg_temp.rec_num('2 undo again: balance as before', bal0, pg_temp.balance_of(chk));

  -- 3 -----------------------------------------------------------------
  all_rows := pg_temp.rows_json(1, 140, d_count, 'Expense', 100, rent_cat);
  all_rows := jsonb_set(all_rows, '{69,type}', '"Transfer"');   -- row 70 of 140
  st := pg_temp.state_of(format('select * from public.import_transactions(%L, %L::jsonb, true, null)', chk, all_rows::text));
  perform pg_temp.rec('3 a forced failure on row 70 of 140 is refused', '22023', st);
  perform pg_temp.rec('3 ... and leaves zero rows written', txs0::text,
    (select count(*)::text from public.transactions where accountid = chk));
  perform pg_temp.rec('3 ... and no import', '0', (select count(*)::text from public.imports where userid = u));

  -- 4 -----------------------------------------------------------------
  all_rows := pg_temp.rows_json(1, 2, d_count, 'Expense', 100, rent_cat) || pg_temp.rows_json(3, 1, d_before, 'Expense', 100, rent_cat);
  st := pg_temp.state_of(format('select * from public.import_transactions(%L, %L::jsonb, null, null)', chk, all_rows::text));
  perform pg_temp.rec('4 a row before the balance date, no answer: refused (SRA01)', 'SRA01', st);
  perform pg_temp.rec('4 ... nothing written', txs0::text,
    (select count(*)::text from public.transactions where accountid = chk));
  -- No row needs the answer: none is asked for.
  all_rows := pg_temp.rows_json(1, 2, d_count, 'Expense', 100, rent_cat);
  select out_import_id into imp from public.import_transactions(chk, all_rows, null, null);
  perform pg_temp.rec('4 rows the date already counts need no answer', '2',
    (select count(*)::text from public.transactions where import_id = imp));
  perform public.undo_import(imp);

  -- 5 -----------------------------------------------------------------
  all_rows := pg_temp.rows_json(1, 5, d_count, 'Expense', 100, rent_cat);
  select out_import_id into imp  from public.import_transactions(chk, all_rows, null, key1);
  select out_import_id into imp2 from public.import_transactions(chk, all_rows, null, key1);
  perform pg_temp.rec('5 the same idempotency key finds the import it wrote', imp::text, imp2::text);
  perform pg_temp.rec('5 ... and writes nothing twice', '5',
    (select count(*)::text from public.transactions where import_id = imp));
  perform pg_temp.rec('5 ... nor a second import', '1', (select count(*)::text from public.imports where userid = u));
  perform public.undo_import(imp);

  -- 6 -----------------------------------------------------------------
  for r in
    select * from (values
      ('amount of zero',            '[{"row":2,"date":"2026-01-02","cents":0,"type":"Expense","description":"x"}]', '22003'),
      ('a negative amount',         '[{"row":2,"date":"2026-01-02","cents":-5,"type":"Expense","description":"x"}]', '22003'),
      ('a fractional amount',       '[{"row":2,"date":"2026-01-02","cents":5.5,"type":"Expense","description":"x"}]', '22003'),
      ('more than numeric(12,2)',   '[{"row":2,"date":"2026-01-02","cents":1000000000000,"type":"Expense","description":"x"}]', '22003'),
      ('an empty description',      '[{"row":2,"date":"2026-01-02","cents":5,"type":"Expense","description":"  "}]', '22001'),
      ('a description over 500',    format('[{"row":2,"date":"2026-01-02","cents":5,"type":"Expense","description":"%s"}]', repeat('x', 501)), '22001'),
      ('a date that isn''t one',    '[{"row":2,"date":"yesterday","cents":5,"type":"Expense","description":"x"}]', '22007'),
      ('a date before 1970',        '[{"row":2,"date":"1969-12-31","cents":5,"type":"Expense","description":"x"}]', '22008'),
      ('a date over a year ahead',  format('[{"row":2,"date":"%s","cents":5,"type":"Expense","description":"x"}]', current_date + 400), '22008'),
      ('a type that isn''t one',    '[{"row":2,"date":"2026-01-02","cents":5,"type":"Transfer","description":"x"}]', '22023'),
      ('a category that isn''t a uuid', '[{"row":2,"date":"2026-01-02","cents":5,"type":"Expense","description":"x","categoryid":"nope"}]', '22P02'),
      ('rows that aren''t an array', '{"row":2}', '22023'),
      ('no rows at all',            '[]', '22023')
    ) as t(what, payload, expected)
  loop
    st := pg_temp.state_of(format('select * from public.import_transactions(%L, %L::jsonb, true, null)', chk, r.payload));
    perform pg_temp.rec('6 refused: ' || r.what, r.expected, st);
  end loop;
  st := pg_temp.state_of(format('select * from public.import_transactions(%L, (select jsonb_agg(jsonb_build_object(''row'', g, ''date'', %L, ''cents'', 1, ''type'', ''Expense'', ''description'', ''x'', ''categoryid'', %L)) from generate_series(1, 5001) g), null, null)',
                                chk, d_count::text, rent_cat));
  perform pg_temp.rec('6 refused: 5,001 rows (the limit is 5,000)', '22023', st);
  -- A category of the wrong type is the database's own trigger (23514).
  st := pg_temp.state_of(format('select * from public.import_transactions(%L, %L::jsonb, null, null)', chk,
    (pg_temp.rows_json(1, 1, d_count, 'Income', 100, rent_cat))::text));
  perform pg_temp.rec('6 refused: an Income row in an Expense category', '23514', st);
  update public.accounts set is_active = false where id = sav;
  perform pg_temp.rec('6 refused: an archived account', '23514',
    pg_temp.state_of(format('select * from public.import_transactions(%L, %L::jsonb, null, null)', sav,
      pg_temp.rows_json(1, 1, d_count, 'Expense', 100, rent_cat)::text)));
  update public.accounts set is_active = true where id = sav;
  perform pg_temp.rec('6 ... none of the above wrote anything', txs0::text,
    (select count(*)::text from public.transactions where accountid = chk));
  perform pg_temp.rec('6 ... nor an import', '0', (select count(*)::text from public.imports where userid = u));

  -- 7 -----------------------------------------------------------------
  insert into public.recurring_transactions
    (id, userid, accountid, categoryid, description, amount, frequency, next_run_date, start_date, next_due_date)
  values (rent_s, u, chk, rent_cat, 'Rent', 1850, 'Monthly', d0, d0, d0);

  all_rows := jsonb_build_array(jsonb_build_object(
    'row', 2, 'date', d0::text, 'cents', 185000, 'type', 'Expense', 'description', 'RENT PAYMENT',
    'categoryid', rent_cat,
    'same_bill', jsonb_build_object('recurringid', rent_s, 'from_run_date', d0, 'to_run_date', d1, 'to_due_date', d1)));

  -- A stale claim: the cursor isn't where the question showed it.
  st := pg_temp.state_of(format('select * from public.import_transactions(%L, %L::jsonb, null, null)', chk,
    jsonb_set(all_rows, '{0,same_bill,from_run_date}', to_jsonb((d0 - 5)::text))::text));
  perform pg_temp.rec('7 a stale "Yes" refuses the whole import (SIM01)', 'SIM01', st);
  perform pg_temp.rec('7 ... no row, no link, no cursor move', '0 ' || d0,
    (select (select count(*) from public.transactions where accountid = chk)::text || ' ' || next_run_date
       from public.recurring_transactions where id = rent_s));

  -- A later bad row: the earlier row's link and cursor move go with it.
  st := pg_temp.state_of(format('select * from public.import_transactions(%L, %L::jsonb, null, null)', chk,
    (all_rows || pg_temp.rows_json(3, 1, d_count, 'Transfer', 100, rent_cat))::text));
  perform pg_temp.rec('7 a bad row after a "Yes" refuses the whole import', '22023', st);
  perform pg_temp.rec('7 ... leaves no link, no cursor move, no answer, no rows', '0 ' || d0 || ' 0',
    (select (select count(*) from public.transactions where accountid = chk)::text || ' ' || r2.next_run_date || ' '
            || (select count(*) from public.same_bill_answers where recurringid = rent_s)::text
       from public.recurring_transactions r2 where r2.id = rent_s));

  -- The real thing.
  select out_import_id into imp from public.import_transactions(chk, all_rows, null, null);
  perform pg_temp.rec('7 "Yes": the row is linked to the schedule', rent_s::text,
    (select recurringid::text from public.transactions where import_id = imp));
  perform pg_temp.rec('7 ... the schedule has stepped past the occurrence', d1::text || ' ' || d1::text,
    (select next_run_date::text || ' ' || next_due_date::text from public.recurring_transactions where id = rent_s));
  perform pg_temp.rec('7 ... so the queue has nothing to ask: the next occurrence is next month''s', d1::text,
    (select next_due_date::text from public.v_upcoming_recurring where recurring_id = rent_s));
  perform pg_temp.rec('7 ... the answer records the step', 'same ' || d0 || ' ' || d0 || ' ' || d1,
    (select answer || ' ' || occurrence_due_date || ' ' || occurrence_run_date || ' ' || advanced_to_run_date
       from public.same_bill_answers where recurringid = rent_s));
  perform pg_temp.rec('7 ... and rent is one transaction, so it counts once', '1',
    (select count(*)::text from public.transactions where accountid = chk and recurringid = rent_s));
  perform pg_temp.rec_num('7 ... the balance fell by the rent exactly once', bal0 - 1850, pg_temp.balance_of(chk));

  -- Undo reverses all three.
  select * into r from public.same_bill_delete_preview((select array_agg(id) from public.transactions where import_id = imp));
  perform pg_temp.rec('7 undo: the preview says the occurrence comes back', 'true Rent ' || d0,
    r.restores::text || ' ' || r.schedule_name || ' ' || r.occurrence_due_date);
  perform public.undo_import(imp);
  perform pg_temp.rec('7 undo: the occurrence is back on the schedule (the queue asks about it again)', d0::text || ' ' || d0::text,
    (select next_run_date::text || ' ' || next_due_date::text from public.recurring_transactions where id = rent_s));
  perform pg_temp.rec('7 undo: the answer and the row are gone', '0 0',
    (select (select count(*) from public.same_bill_answers where recurringid = rent_s)::text || ' '
            || (select count(*) from public.transactions where accountid = chk)::text));
  perform pg_temp.rec_num('7 undo: the balance is as before', bal0, pg_temp.balance_of(chk));

  -- "No, keep both".
  all_rows := jsonb_build_array(jsonb_build_object(
    'row', 2, 'date', d0::text, 'cents', 185000, 'type', 'Expense', 'description', 'RENT PAYMENT',
    'categoryid', rent_cat,
    'different_bill', jsonb_build_object('recurringid', rent_s, 'due_date', d0)));
  select out_import_id into imp from public.import_transactions(chk, all_rows, null, null);
  perform pg_temp.rec('7 "No": remembered as item 4 remembers it', 'different ' || d0,
    (select answer || ' ' || occurrence_due_date from public.same_bill_answers where recurringid = rent_s));
  perform pg_temp.rec('7 ... and nothing linked, nothing stepped', '<null> ' || d0,
    (select coalesce(t.recurringid::text, '<null>') || ' ' || s.next_run_date
       from public.transactions t, public.recurring_transactions s where t.import_id = imp and s.id = rent_s));
  perform public.undo_import(imp);
  perform pg_temp.rec('7 undo: that answer goes with the row', '0',
    (select count(*)::text from public.same_bill_answers where recurringid = rent_s));

  -- 8 -----------------------------------------------------------------
  perform pg_temp.unbecome();
  perform pg_temp.become(v);
  select out_import_id into vimp
    from public.import_transactions(vchk, pg_temp.rows_json(1, 3, current_date - 1,
         'Expense', 100, (select id from public.categories where userid = v and category_name = 'Rent')), null, null);
  perform pg_temp.unbecome();
  perform pg_temp.become(u);

  perform pg_temp.rec('8 import into another user''s account: refused (P0002)', 'P0002',
    pg_temp.state_of(format('select * from public.import_transactions(%L, %L::jsonb, null, null)', vchk,
      pg_temp.rows_json(1, 1, d_count, 'Expense', 100, rent_cat)::text)));
  perform pg_temp.rec('8 ... and a made-up account is refused the same way', 'P0002',
    pg_temp.state_of(format('select * from public.import_transactions(%L, %L::jsonb, null, null)', gen_random_uuid(),
      pg_temp.rows_json(1, 1, d_count, 'Expense', 100, rent_cat)::text)));
  perform pg_temp.rec('8 preview for another user''s account: refused (P0002)', 'P0002',
    pg_temp.state_of(format('select * from public.import_preview(%L, array[current_date])', vchk)));
  perform pg_temp.rec('8 undo another user''s import: refused (P0002)', 'P0002',
    pg_temp.state_of(format('select * from public.undo_import(%L)', vimp)));
  perform pg_temp.unbecome();
  perform pg_temp.rec('8 ... and their rows are still there (seen as the owner)', '3',
    (select count(*)::text from public.transactions where import_id = vimp));
  perform pg_temp.become(u);
  perform pg_temp.rec('8 list_imports() shows only your own', '0',
    (select count(*)::text from public.list_imports() where import_id = vimp));

  -- 9 -----------------------------------------------------------------
  perform pg_temp.rec('9 a direct INSERT into imports is refused', '42501',
    pg_temp.state_of(format('insert into public.imports (userid, accountid, row_count) values (%L, %L, 1)', u, chk)));
  select out_import_id into imp from public.import_transactions(chk, pg_temp.rows_json(1, 4, d_count, 'Expense', 100, rent_cat), null, null);
  perform pg_temp.rec('9 a direct UPDATE of imports is refused', '42501',
    pg_temp.state_of(format('update public.imports set row_count = 1 where id = %L', imp)));
  perform pg_temp.rec('9 a direct DELETE of imports is refused', '42501',
    pg_temp.state_of(format('delete from public.imports where id = %L', imp)));

  -- 10 ----------------------------------------------------------------
  perform pg_temp.rec('10 list_imports(): rows written, left, edited', '4 4 0',
    (select row_count || ' ' || remaining_count || ' ' || edited_count from public.list_imports() where import_id = imp));
  perform pg_temp.unbecome();
  -- The table owner moves one row's updated_at (the trigger would reset it).
  alter table public.transactions disable trigger trg_transactions_updated_at;
  update public.transactions set updated_at = created_at + interval '1 minute'
   where id = (select id from public.transactions where import_id = imp order by id limit 1);
  alter table public.transactions enable trigger trg_transactions_updated_at;
  -- 9 (continued) RESTRICT: the owner can't delete an import that still has rows.
  perform pg_temp.rec('9 deleting an import with transactions is refused: RESTRICT, never CASCADE', '23503',
    pg_temp.state_of(format('delete from public.imports where id = %L', imp)));
  perform pg_temp.rec('9 ... and the transactions are still there', '4',
    (select count(*)::text from public.transactions where import_id = imp));
  perform pg_temp.become(u);
  perform pg_temp.rec('10 list_imports(): one row was edited since', '4 4 1',
    (select row_count || ' ' || remaining_count || ' ' || edited_count from public.list_imports() where import_id = imp));
  delete from public.transactions where id = (select id from public.transactions where import_id = imp order by id limit 1);
  perform pg_temp.rec('10 list_imports(): a row deleted by hand is no longer remaining', '4 3',
    (select row_count || ' ' || remaining_count from public.list_imports() where import_id = imp));

  -- 11 ----------------------------------------------------------------
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, chk, rent_cat, 1850, 'Expense', current_date - 2, 'Rent by hand');
  perform pg_temp.rec('11 item 4 is unchanged: "Yes" on an entry that isn''t dated ahead', 'not_ahead',
    public.confirm_same_bill((select id from public.transactions where description = 'Rent by hand' and userid = u),
                             rent_s, d0, d1, d1));
  perform pg_temp.rec('11 ... same_bill_answer() is not callable by a person', '42501',
    pg_temp.state_of(format('select public.same_bill_answer(%L, %L, %L, %L, %L, false)',
      gen_random_uuid(), rent_s, d0, d1, d1)));

  -- 12 ----------------------------------------------------------------
  perform public.delete_own_account();
  perform pg_temp.unbecome();
  perform pg_temp.rec('12 delete_own_account() leaves no import behind', '0 0',
    (select (select count(*) from public.imports where userid = u)::text || ' '
            || (select count(*) from public.transactions where userid = u)::text));
  perform pg_temp.rec('12 ... and doesn''t touch another user''s', '1 3',
    (select (select count(*) from public.imports where userid = v)::text || ' '
            || (select count(*) from public.transactions where userid = v)::text));
end
$$;

-- The summary is the LAST row. A run counts as passed only when it says
-- ALL PASS (CLAUDE.md): every row true AND sections 1-12 all present. A
-- run that errors part-way returns no rows at all. (Added with migration
-- 76, which changes the functions this script calls.)
with expected(s) as (select unnest(array['1','2','3','4','5','6','7','8','9','10','11','12'])),
tally as (
  select (select count(*) from ic_results)                as total,
         (select count(*) from ic_results where not pass) as failed,
         (select string_agg(e.s, ', ' order by e.s::int) from expected e
           where not exists (select 1 from ic_results r where split_part(r.check_, ' ', 1) = e.s)) as missing
)
select check_ as check, expected, actual, pass
  from (select seq, check_, expected, actual, pass from ic_results
        union all
        select 2147483647, 'SUMMARY', 'ALL PASS (every row true, sections 1-12 present)',
               t.total || ' rows, ' || t.failed || ' false'
                 || coalesce(', missing sections: ' || t.missing, '')
                 || ' -- ' || case when t.failed = 0 and t.missing is null then 'ALL PASS' else 'NOT PASSED' end,
               t.failed = 0 and t.missing is null
          from tally t) x
 order by seq;

rollback;
