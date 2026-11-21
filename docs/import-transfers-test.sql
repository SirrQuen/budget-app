-- =====================================================================
-- Import: transfers and categories test (migration 76, docs/Import-CSV.md)
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/import-transfers-test.sql
--
-- It writes, then rolls back, so it isn't --read-only and the CLI asks
-- for confirmation: Matt runs it. Read the Target line first.
--
-- A run counts as passed only when its LAST row, SUMMARY, says ALL PASS
-- (CLAUDE.md). Self-cleaning: two throwaway users, one transaction,
-- ROLLBACK. Cleanup check (must be 0):
--   select count(*) from auth.users where email like 'it-test-%@example.invalid';
--
-- What only the database can show (the matching, the wording flag, the
-- suggestions and the per-row categories are TypeScript, pinned by
-- lib/importTransfers.test.ts and lib/importSameBill.test.ts):
--
--   1  Create both legs: one transfer, two rows, both carrying the
--      import, no category, opposite types, the right accounts; checking
--      falls and savings rises by exactly the amount.
--   2  The other leg answers ITS OWN account's balance date: no answer
--      refuses the batch (SRA01); an answer lands on that leg only, with
--      that account's opening_set_at.
--   3  Pair: an existing plain Visa row becomes the other leg -- date,
--      amount, account and anchor answer unchanged, category cleared,
--      prior category kept; the Visa balance doesn't move.
--   4  Every pair_with is re-checked: a scheduled row, the same
--      direction, a cent off, 6 days off, an Income leg with a goal, a
--      row claimed twice in one batch, a join plus a same-bill answer.
--   5  Undo restores the joined row exactly (every column but
--      updated_at) and removes the legs it created.
--   6  An earlier import whose row a later import joined can't be undone
--      first (SIU01, naming the later import's date); after the later
--      one, it can.
--   7  The category is checked by row: archived, another user's, wrong
--      type -- each its own message, nothing written.
--   8  list_imports() counts occurrences: a created transfer is one.
--   9  A card payment imported as a transfer is counted once: Spendable
--      Cash minus what the card payment schedule expects is unchanged.
--      Imported as spending (the old way), it fell by the payment twice
--      over -- the control that shows the check can fail.
--  10  A transfer can answer "same bill" for a transfer schedule: both
--      legs linked, the schedule stepped; undo puts it back.
--  11  delete_own_account() leaves no pairing behind.
-- =====================================================================

begin;

create temp table it_results (
  seq      serial primary key,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
grant insert, select on it_results to authenticated;
grant usage on sequence it_results_seq_seq to authenticated;

create function pg_temp.rec(p_check text, p_expected text, p_actual text) returns void
language sql as $$
  insert into it_results (check_, expected, actual, pass)
  values (p_check, p_expected, coalesce(p_actual, '<null>'), coalesce(p_expected = p_actual, false))
$$;

create function pg_temp.rec_num(p_check text, p_expected numeric, p_actual numeric) returns void
language sql as $$
  insert into it_results (check_, expected, actual, pass)
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

-- The SQLSTATE a statement fails with, or 'ok'.
create function pg_temp.state_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end
$$;

-- The message a statement fails with, or 'ok'.
create function pg_temp.message_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end
$$;

create function pg_temp.balance_of(p_account uuid) returns numeric language sql as $$
  select balance from public.v_account_balances where account_id = p_account
$$;

-- One file row as import_transactions() takes it.
create function pg_temp.r(p_row int, p_date date, p_cents bigint, p_type text, p_desc text,
                          p_cat uuid default null, p_transfer jsonb default null) returns jsonb
language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'row', p_row, 'date', p_date::text, 'cents', p_cents, 'type', p_type, 'description', p_desc,
    'categoryid', p_cat, 'transfer', p_transfer))
$$;

create function pg_temp.import1(p_account uuid, p_rows jsonb, p_answer boolean default null) returns uuid
language sql as $$
  select out_import_id from public.import_transactions(p_account, p_rows, p_answer, null)
$$;

-- A row as a comparable value: every column but updated_at.
create function pg_temp.snapshot(p_id uuid) returns jsonb language sql as $$
  select to_jsonb(t) - 'updated_at' from public.transactions t where id = p_id
$$;

insert into auth.users (id, instance_id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'it-test-d@example.invalid', '{}'::jsonb,
        '{"first_name": "It", "last_name": "Test"}'::jsonb, now(), now()),
       ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'it-test-c@example.invalid', '{}'::jsonb,
        '{"first_name": "It", "last_name": "Other"}'::jsonb, now(), now());

do $$
declare
  u        constant uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  v        constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  chk      constant uuid := 'dddddddd-0000-4000-8000-000000000001';
  sav      constant uuid := 'dddddddd-0000-4000-8000-000000000002';
  visa     constant uuid := 'dddddddd-0000-4000-8000-000000000003';
  card_s   constant uuid := 'dddddddd-0000-4000-8000-000000000011';
  fixed_s  constant uuid := 'dddddddd-0000-4000-8000-000000000012';
  d_now    constant date := current_date - 2;   -- counts on every account
  d_sav    constant date := current_date - 10;  -- counts on checking, before savings' balance date
  groc     uuid;
  pay_cat  uuid;
  cc_cat   uuid;
  v_cat    uuid;
  arch_cat uuid;
  imp      uuid;
  imp_a    uuid;
  imp_b    uuid;
  grp      uuid;
  visa_row uuid;
  snap     jsonb;
  chk0     numeric;
  sav0     numeric;
  visa0    numeric;
  cash0    numeric;
  owed0    numeric;
  st       text;
  msg      text;
  n        int;
  d0       constant date := current_date - 1;
  d1       date := (current_date - 1 + interval '1 month')::date;
begin
  select id into groc    from public.categories where userid = u and category_name = 'Groceries';
  select id into pay_cat from public.categories where userid = u and category_name = 'Paychecks/Salary';
  select id into v_cat   from public.categories where userid = v and category_name = 'Groceries';
  -- An Income category to hand-log a card payment in, as people do.
  select id into cc_cat  from public.categories where userid = u and category_type = 'Income' and id <> pay_cat
   order by category_name limit 1;

  perform pg_temp.become(u);
  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (chk,  u, 'IT checking', 'Checking',    5000, current_date - 30),
         (sav,  u, 'IT savings',  'Savings',     1000, current_date - 5),
         (visa, u, 'IT visa',     'Credit Card', -800, current_date - 30);
  -- A category to archive.
  insert into public.categories (userid, groupid, category_name, category_type)
  select u, groupid, 'IT archived', 'Expense' from public.categories where id = groc
  returning id into arch_cat;
  update public.categories set is_active = false where id = arch_cat;

  chk0 := pg_temp.balance_of(chk);
  sav0 := pg_temp.balance_of(sav);
  visa0 := pg_temp.balance_of(visa);

  -- 1 -----------------------------------------------------------------
  imp := pg_temp.import1(chk, jsonb_build_array(
    pg_temp.r(2, d_now, 25000, 'Expense', 'ONLINE TRANSFER TO SAV', null, jsonb_build_object('other_accountid', sav))));
  select transfer_group_id into grp from public.transactions where import_id = imp and accountid = chk;
  perform pg_temp.rec('1 create: one file row is two legs, both carrying the import', '2',
    (select count(*)::text from public.transactions where import_id = imp and transfer_group_id = grp));
  perform pg_temp.rec('1 ... Expense on checking, Income on savings, no category on either',
    'Expense ' || chk || ' | Income ' || sav || ' | 0',
    (select string_agg(transaction_type || ' ' || accountid, ' | ' order by transaction_type)
       from public.transactions where transfer_group_id = grp)
      || ' | ' || (select count(*) from public.transactions where transfer_group_id = grp and categoryid is not null));
  perform pg_temp.rec_num('1 ... checking falls by exactly the amount', chk0 - 250, pg_temp.balance_of(chk));
  perform pg_temp.rec_num('1 ... savings rises by exactly the amount', sav0 + 250, pg_temp.balance_of(sav));
  perform pg_temp.rec('1 undo: both legs go', '2', (select out_deleted::text from public.undo_import(imp)));
  perform pg_temp.rec_num('1 undo: checking as before', chk0, pg_temp.balance_of(chk));
  perform pg_temp.rec_num('1 undo: savings as before', sav0, pg_temp.balance_of(sav));

  -- 2 -----------------------------------------------------------------
  st := pg_temp.state_of(format('select public.import_transactions(%L, %L::jsonb, null, null)', chk,
    jsonb_build_array(pg_temp.r(2, d_sav, 10000, 'Expense', 'XFER', null, jsonb_build_object('other_accountid', sav)))::text));
  perform pg_temp.rec('2 a leg before SAVINGS'' balance date, no answer for savings: refused', 'SRA01', st);
  perform pg_temp.rec('2 ... nothing written', '0',
    (select count(*)::text from public.transactions where accountid in (chk, sav)));

  imp := pg_temp.import1(chk, jsonb_build_array(
    pg_temp.r(2, d_sav, 10000, 'Expense', 'XFER', null,
              jsonb_build_object('other_accountid', sav, 'counts_despite_anchor', true))));
  perform pg_temp.rec('2 savings'' answer is on the savings leg, against savings'' own anchor', 'true true',
    (select (counts_despite_anchor is true)::text || ' '
            || (anchor_answer_set_at = (select opening_set_at from public.accounts where id = sav))::text
       from public.transactions where import_id = imp and accountid = sav));
  perform pg_temp.rec('2 ... and the checking leg, which its date already counts, carries none', 'true',
    (select (counts_despite_anchor is null and anchor_answer_set_at is null)::text
       from public.transactions where import_id = imp and accountid = chk));
  perform pg_temp.rec_num('2 ... "No, add it": savings rises by the amount', sav0 + 100, pg_temp.balance_of(sav));
  perform public.undo_import(imp);

  -- 3 -----------------------------------------------------------------
  -- A card payment hand-logged on the Visa as income, the way people do.
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, visa, cc_cat, 500, 'Income', d_now - 1, 'Visa payment by hand')
  returning id into visa_row;
  snap := pg_temp.snapshot(visa_row);
  visa0 := pg_temp.balance_of(visa);

  imp := pg_temp.import1(chk, jsonb_build_array(
    pg_temp.r(2, d_now, 50000, 'Expense', 'AUTOPAY PAYMENT VISA', null,
              jsonb_build_object('other_accountid', visa, 'pair_with', visa_row))));
  select transfer_group_id into grp from public.transactions where import_id = imp;
  perform pg_temp.rec('3 pair: the Visa row is now the other leg', grp::text,
    (select transfer_group_id::text from public.transactions where id = visa_row));
  perform pg_temp.rec('3 ... its date, amount, account and anchor answer are unchanged; its category is cleared',
    (snap ->> 'transaction_date') || ' ' || (snap ->> 'amount') || ' ' || (snap ->> 'accountid') || ' <null> <null>',
    (select transaction_date || ' ' || amount || ' ' || accountid || ' '
            || coalesce(counts_despite_anchor::text, '<null>') || ' ' || coalesce(categoryid::text, '<null>')
       from public.transactions where id = visa_row));
  perform pg_temp.rec('3 ... the legs keep each bank''s own day', (d_now - 1) || ' ' || d_now,
    (select string_agg(transaction_date::text, ' ' order by transaction_date) from public.transactions where transfer_group_id = grp));
  perform pg_temp.rec('3 ... the import wrote one row; the Visa row isn''t the import''s', '1 <null>',
    (select count(*)::text from public.transactions where import_id = imp) || ' '
      || (select coalesce(import_id::text, '<null>') from public.transactions where id = visa_row));
  perform pg_temp.rec('3 ... its prior category is kept', cc_cat::text,
    (select prior_categoryid::text from public.import_pairings where transactionid = visa_row and import_id = imp));
  perform pg_temp.rec_num('3 ... the Visa balance doesn''t move (the payment was already there)', visa0, pg_temp.balance_of(visa));
  perform pg_temp.rec_num('3 ... checking falls by the payment, once', chk0 - 500, pg_temp.balance_of(chk));
  perform pg_temp.rec('3 ... the pair is whole: two legs, one amount, two types', '2 1 2',
    (select count(*) || ' ' || count(distinct amount) || ' ' || count(distinct transaction_type)
       from public.transactions where transfer_group_id = grp));

  -- 5 -----------------------------------------------------------------
  perform pg_temp.rec('5 undo: the leg it created goes', '1', (select out_deleted::text from public.undo_import(imp)));
  perform pg_temp.rec('5 ... the Visa row is back exactly as it was (every column but updated_at)', snap::text,
    pg_temp.snapshot(visa_row)::text);
  perform pg_temp.rec('5 ... and its pairing record is gone', '0',
    (select count(*)::text from public.import_pairings where transactionid = visa_row));
  perform pg_temp.rec_num('5 ... checking as before', chk0, pg_temp.balance_of(chk));

  -- 4 -----------------------------------------------------------------
  insert into public.recurring_transactions
    (id, userid, accountid, to_accountid, description, amount, frequency,
     next_run_date, start_date, next_due_date)
  values (fixed_s, u, chk, visa, 'IT fixed card payment', 500, 'Monthly', d0, d0, d0);
  -- (An Income leg with a goal can't be built: transactions_goal_expense_only
  -- refuses a goal on any Income row, so ruling 2's goal clause holds by
  -- construction. The function checks it anyway.)

  for st, msg in
    select * from (values
      ('a row on a schedule',
       format('update public.transactions set recurringid = %L where id = %L', fixed_s, visa_row)),
      ('the same direction',
       format('update public.transactions set transaction_type = ''Expense'', categoryid = %L where id = %L', groc, visa_row)),
      ('a cent off',
       format('update public.transactions set amount = 500.01 where id = %L', visa_row)),
      ('6 days off',
       format('update public.transactions set transaction_date = %L where id = %L', d_now - 6, visa_row))
    ) as t(what, change)
  loop
    -- Change the Visa row, try to join it, then put it back.
    perform pg_temp.unbecome();
    alter table public.transactions disable trigger trg_transactions_anchor_answer;
    execute msg;
    alter table public.transactions enable trigger trg_transactions_anchor_answer;
    perform pg_temp.become(u);
    perform pg_temp.rec('4 refused to join ' || st, 'SIP01',
      pg_temp.state_of(format('select public.import_transactions(%L, %L::jsonb, null, null)', chk,
        jsonb_build_array(pg_temp.r(2, d_now, 50000, 'Expense', 'PAYMENT', null,
          jsonb_build_object('other_accountid', visa, 'pair_with', visa_row)))::text)));
    perform pg_temp.unbecome();
    alter table public.transactions disable trigger trg_transactions_anchor_answer;
    update public.transactions
       set recurringid = null, transaction_type = 'Income', categoryid = cc_cat, amount = 500,
           transaction_date = d_now - 1
     where id = visa_row;
    alter table public.transactions enable trigger trg_transactions_anchor_answer;
    perform pg_temp.become(u);
  end loop;

  perform pg_temp.rec('4 refused: one entry claimed by two rows in one batch', 'SIP01',
    pg_temp.state_of(format('select public.import_transactions(%L, %L::jsonb, null, null)', chk,
      jsonb_build_array(
        pg_temp.r(2, d_now, 50000, 'Expense', 'PAYMENT 1', null, jsonb_build_object('other_accountid', visa, 'pair_with', visa_row)),
        pg_temp.r(3, d_now, 50000, 'Expense', 'PAYMENT 2', null, jsonb_build_object('other_accountid', visa, 'pair_with', visa_row)))::text)));
  perform pg_temp.rec('4 refused: a join that also answers a schedule', '23514',
    pg_temp.state_of(format('select public.import_transactions(%L, %L::jsonb, null, null)', chk,
      jsonb_build_array(pg_temp.r(2, d_now, 50000, 'Expense', 'PAYMENT', null,
        jsonb_build_object('other_accountid', visa, 'pair_with', visa_row))
        || jsonb_build_object('different_bill', jsonb_build_object('recurringid', fixed_s, 'due_date', d0)))::text)));
  perform pg_temp.rec('4 refused: a transfer to the import''s own account', '23514',
    pg_temp.state_of(format('select public.import_transactions(%L, %L::jsonb, null, null)', chk,
      jsonb_build_array(pg_temp.r(2, d_now, 100, 'Expense', 'X', null, jsonb_build_object('other_accountid', chk)))::text)));
  perform pg_temp.rec('4 refused: a transfer with a category', '23514',
    pg_temp.state_of(format('select public.import_transactions(%L, %L::jsonb, null, null)', chk,
      jsonb_build_array(pg_temp.r(2, d_now, 100, 'Expense', 'X', groc, jsonb_build_object('other_accountid', sav)))::text)));
  perform pg_temp.rec('4 ... none of the refusals wrote anything or touched the Visa row', '0 0 ' || snap::text,
    (select count(*)::text from public.transactions where accountid = chk) || ' '
      || (select count(*)::text from public.imports where userid = u) || ' ' || pg_temp.snapshot(visa_row)::text);

  -- 6 -----------------------------------------------------------------
  -- Import A brings the Visa payment in as income; import B (checking)
  -- then joins it. A can't be undone until B is.
  delete from public.transactions where id = visa_row;
  imp_a := pg_temp.import1(visa, jsonb_build_array(pg_temp.r(2, d_now - 1, 30000, 'Income', 'PAYMENT THANK YOU', cc_cat)));
  select id into visa_row from public.transactions where import_id = imp_a;
  snap := pg_temp.snapshot(visa_row);
  imp_b := pg_temp.import1(chk, jsonb_build_array(pg_temp.r(2, d_now, 30000, 'Expense', 'VISA AUTOPAY', null,
    jsonb_build_object('other_accountid', visa, 'pair_with', visa_row))));
  msg := pg_temp.message_of(format('select public.undo_import(%L)', imp_a));
  perform pg_temp.rec('6 undoing the earlier import first is refused, naming the later one''s day',
    'Undo the import from ' || to_char((select created_at from public.imports where id = imp_b)::date, 'YYYY-MM-DD') || ' first.', msg);
  perform pg_temp.rec('6 ... with SIU01', 'SIU01', pg_temp.state_of(format('select public.undo_import(%L)', imp_a)));
  perform pg_temp.rec('6 ... and nothing moved: both imports there, the Visa row still a leg', '2 true',
    (select count(*)::text from public.imports where id in (imp_a, imp_b)) || ' '
      || (select (transfer_group_id is not null)::text from public.transactions where id = visa_row));
  perform public.undo_import(imp_b);
  perform pg_temp.rec('6 after the later one, the Visa row is as import A wrote it', snap::text, pg_temp.snapshot(visa_row)::text);
  perform pg_temp.rec('6 ... and the earlier one undoes', '1', (select out_deleted::text from public.undo_import(imp_a)));

  -- 7 -----------------------------------------------------------------
  msg := pg_temp.message_of(format('select public.import_transactions(%L, %L::jsonb, null, null)', chk,
    jsonb_build_array(pg_temp.r(3, d_now, 100, 'Expense', 'X', arch_cat))::text));
  perform pg_temp.rec('7 an archived category is refused by row number, not the generic error', 'Row 3 could not be imported: its category is archived. Choose another.', msg);
  msg := pg_temp.message_of(format('select public.import_transactions(%L, %L::jsonb, null, null)', chk,
    jsonb_build_array(pg_temp.r(4, d_now, 100, 'Expense', 'X', v_cat))::text));
  perform pg_temp.rec('7 another user''s category: its own message', 'Row 4 could not be imported: its category is not one of yours.', msg);
  msg := pg_temp.message_of(format('select public.import_transactions(%L, %L::jsonb, null, null)', chk,
    jsonb_build_array(pg_temp.r(5, d_now, 100, 'Expense', 'X', pay_cat))::text));
  perform pg_temp.rec('7 a category of the other type: its own message', 'Row 5 could not be imported: its category is for income.', msg);
  perform pg_temp.rec('7 ... nothing written', '0 0',
    (select count(*)::text from public.transactions where accountid = chk) || ' '
      || (select count(*)::text from public.imports where userid = u));

  -- 8 -----------------------------------------------------------------
  imp := pg_temp.import1(chk, jsonb_build_array(
    pg_temp.r(2, d_now, 1200, 'Expense', 'TESCO', groc),
    pg_temp.r(3, d_now, 7000, 'Expense', 'XFER', null, jsonb_build_object('other_accountid', sav))));
  perform pg_temp.rec('8 list_imports(): a created transfer is one occurrence, not two rows', '2 2 0',
    (select row_count || ' ' || remaining_count || ' ' || edited_count from public.list_imports() where import_id = imp));
  perform public.undo_import(imp);

  -- 9 -----------------------------------------------------------------
  -- A card payment schedule estimated from what the card owes. The
  -- forecast commits Spendable Cash to card_balance_owed; paying the card
  -- moves money out of checking AND lowers what's owed, so Spendable Cash
  -- minus the commitment must not move. Imported as spending, only the
  -- first half happens: the payment counts twice.
  insert into public.recurring_transactions
    (id, userid, accountid, to_accountid, description, amount, frequency,
     next_run_date, start_date, next_due_date, amount_is_variable, statement_day)
  values (card_s, u, chk, visa, 'IT card payment', 0, 'Monthly', current_date + 8, current_date + 8, current_date + 8, true, 1);
  cash0 := public.spendable_cash_balance();
  owed0 := (select card_balance_owed from public.v_recurring_amounts where recurring_id = card_s);
  perform pg_temp.rec_num('9 setup: the card owes what its balance says', 800, owed0);

  imp := pg_temp.import1(chk, jsonb_build_array(pg_temp.r(2, d_now, 30000, 'Expense', 'VISA PAYMENT', null,
    jsonb_build_object('other_accountid', visa))));
  perform pg_temp.rec_num('9 as a transfer: Spendable Cash less the card commitment is unchanged (counted once)',
    cash0 - owed0,
    public.spendable_cash_balance() - (select card_balance_owed from public.v_recurring_amounts where recurring_id = card_s));
  perform pg_temp.rec_num('9 ... cash fell by the payment', cash0 - 300, public.spendable_cash_balance());
  perform pg_temp.rec_num('9 ... and what the card owes fell by it too', owed0 - 300,
    (select card_balance_owed from public.v_recurring_amounts where recurring_id = card_s));
  perform public.undo_import(imp);

  imp := pg_temp.import1(chk, jsonb_build_array(pg_temp.r(2, d_now, 30000, 'Expense', 'VISA PAYMENT', groc)));
  perform pg_temp.rec_num('9 control, as spending (the old way): it drops by the payment -- counted twice',
    cash0 - owed0 - 300,
    public.spendable_cash_balance() - (select card_balance_owed from public.v_recurring_amounts where recurring_id = card_s));
  perform public.undo_import(imp);
  delete from public.recurring_transactions where id = card_s;

  -- 10 ----------------------------------------------------------------
  imp := pg_temp.import1(chk, jsonb_build_array(
    pg_temp.r(2, d0, 50000, 'Expense', 'CARD PAYMENT', null, jsonb_build_object('other_accountid', visa))
    || jsonb_build_object('same_bill', jsonb_build_object('recurringid', fixed_s, 'from_run_date', d0,
                                                          'to_run_date', d1, 'to_due_date', d1))));
  perform pg_temp.rec('10 a transfer answers a transfer schedule: both legs linked', '2',
    (select count(*)::text from public.transactions where recurringid = fixed_s));
  perform pg_temp.rec('10 ... the schedule stepped past the occurrence', d1::text,
    (select next_run_date::text from public.recurring_transactions where id = fixed_s));
  perform public.undo_import(imp);
  perform pg_temp.rec('10 undo: the occurrence is back', d0::text,
    (select next_run_date::text from public.recurring_transactions where id = fixed_s));

  -- 11 ----------------------------------------------------------------
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, visa, cc_cat, 45, 'Income', d_now, 'Visa by hand')
  returning id into visa_row;
  imp := pg_temp.import1(chk, jsonb_build_array(pg_temp.r(2, d_now, 4500, 'Expense', 'PAY VISA', null,
    jsonb_build_object('other_accountid', visa, 'pair_with', visa_row))));
  perform pg_temp.rec('11 setup: a pairing exists', '1', (select count(*)::text from public.import_pairings where userid = u));
  perform public.delete_own_account();
  perform pg_temp.unbecome();
  perform pg_temp.rec('11 delete_own_account() leaves no pairing, transaction or import', '0 0 0',
    (select (select count(*) from public.import_pairings where userid = u)::text || ' '
            || (select count(*) from public.transactions where userid = u)::text || ' '
            || (select count(*) from public.imports where userid = u)::text));
end
$$;

-- The summary is the LAST row. A run counts as passed only when it says
-- ALL PASS (CLAUDE.md): every row true AND every numbered section present.
-- A run that errors part-way returns no rows at all.
with expected(s) as (select unnest(array['1','2','3','4','5','6','7','8','9','10','11'])),
tally as (
  select (select count(*) from it_results)                as total,
         (select count(*) from it_results where not pass) as failed,
         (select string_agg(e.s, ', ' order by e.s::int) from expected e
           where not exists (select 1 from it_results r where split_part(r.check_, ' ', 1) = e.s)) as missing
)
select check_ as check, expected, actual, pass
  from (select seq, check_, expected, actual, pass from it_results
        union all
        select 2147483647, 'SUMMARY', 'ALL PASS (every row true, sections 1-11 present)',
               t.total || ' rows, ' || t.failed || ' false'
                 || coalesce(', missing sections: ' || t.missing, '')
                 || ' -- ' || case when t.failed = 0 and t.missing is null then 'ALL PASS' else 'NOT PASSED' end,
               t.failed = 0 and t.missing is null
          from tally t) x
 order by seq;

rollback;
