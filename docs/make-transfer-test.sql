-- =====================================================================
-- "Turn into a transfer" test (migration 80)
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/make-transfer-test.sql
--
-- It writes, then rolls back, so it isn't --read-only and the CLI asks
-- for confirmation: Matt runs it. Read the Target line first.
--
-- A run counts as passed only when its LAST row, SUMMARY, says ALL PASS
-- (CLAUDE.md). Self-cleaning: two throwaway users, one transaction,
-- ROLLBACK. Cleanup check (must be 0):
--   select count(*) from auth.users where email like 'mt-test-%@example.invalid';
--
-- What only the database can show (the matching and the dialog's
-- sentences are TypeScript, pinned by lib/importTransfers.test.ts and
-- lib/turnIntoTransfer.test.ts):
--
--   1  Create: a checking Expense becomes a transfer to savings -- two
--      legs, no category, the conversion recorded; checking unchanged,
--      savings up by exactly the amount.
--   2  The created leg answers SAVINGS' balance date: no answer refuses
--      (SRA01) and writes nothing; a stale anchor refuses (SRA02); an
--      answer lands on that leg only.
--   3  Join: a plain Visa Income entry becomes the other leg -- dates,
--      amounts, accounts kept, both categories recorded, no balance
--      moves.
--   4  Refusals of the entry itself (SMT01): already a leg, from a
--      schedule, a same-bill answer, the same account, an archived
--      account; another user's entry or account (P0002).
--   5  Refusals of the entry to join (SMT02): same direction, a cent off,
--      6 days off, on a schedule, not on the chosen account.
--   6  A goal: an Expense entry with a goal becomes the Expense leg and
--      keeps it (ruling 1).
--   7  Undo after create: the entry is back exactly (every column but
--      updated_at); the created leg and the record are gone.
--   8  Undo after join: both entries back exactly.
--   9  Undo after an edit (update_transfer changed the amount): the edit
--      is kept, the category restored (ruling 2). After a direction swap
--      it refuses (SMT03) and changes nothing.
--  10  undo_import reverses a conversion made from its row first, and
--      undo_import_conversions() counted it (ruling 4). list_imports()
--      (migration 81): an untouched import has no edits; the conversion
--      isn't one; an ordinary edit is, and so is an edit to the converted
--      row after the conversion.
--  11  undo_import refuses (SIU02, naming the date) while a conversion
--      from an entry outside it joined one of its rows; after Undo, it
--      goes through.
--  12  separate_import_transfer: refused without a fitting category of
--      the person's own (SMT04); then the entry goes back as it was and
--      the imported side STAYS, on its own, in the chosen category (ruled
--      2026-11-24); no balance moves; undo_import still removes it later.
--  13  The import's join still refuses through the shared check (SIP01).
--  14  Deleting a converted transfer leaves no record; delete_own_account
--      leaves none either.
--  15  The added side answers "Is this the same bill?" for a transfer
--      schedule's waiting occurrence, as import does: "Yes" links both
--      legs and steps the schedule; Undo steps it back and unlinks; "No"
--      is remembered and Undo forgets it; a join can't answer (SMT02); a
--      stale occurrence refuses (SMT05).
-- =====================================================================

begin;

create temp table mt_results (
  seq      serial primary key,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
grant insert, select on mt_results to authenticated;
grant usage on sequence mt_results_seq_seq to authenticated;

create function pg_temp.rec(p_check text, p_expected text, p_actual text) returns void
language sql as $$
  insert into mt_results (check_, expected, actual, pass)
  values (p_check, p_expected, coalesce(p_actual, '<null>'), coalesce(p_expected = p_actual, false))
$$;

create function pg_temp.rec_num(p_check text, p_expected numeric, p_actual numeric) returns void
language sql as $$
  insert into mt_results (check_, expected, actual, pass)
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

create function pg_temp.state_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end
$$;

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

-- A row as a comparable value: every column but updated_at.
create function pg_temp.snapshot(p_id uuid) returns jsonb language sql as $$
  select to_jsonb(t) - 'updated_at' from public.transactions t where id = p_id
$$;

create function pg_temp.r(p_row int, p_date date, p_cents bigint, p_type text, p_desc text,
                          p_cat uuid default null, p_transfer jsonb default null) returns jsonb
language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'row', p_row, 'date', p_date::text, 'cents', p_cents, 'type', p_type, 'description', p_desc,
    'categoryid', p_cat, 'transfer', p_transfer))
$$;

insert into auth.users (id, instance_id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'mt-test-e@example.invalid', '{}'::jsonb,
        '{"first_name": "Mt", "last_name": "Test"}'::jsonb, now(), now()),
       ('ffffffff-ffff-4fff-8fff-ffffffffffff', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'mt-test-f@example.invalid', '{}'::jsonb,
        '{"first_name": "Mt", "last_name": "Other"}'::jsonb, now(), now());

do $$
declare
  u        constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  v        constant uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  chk      constant uuid := 'eeeeeeee-0000-4000-8000-000000000001';
  sav      constant uuid := 'eeeeeeee-0000-4000-8000-000000000002';
  visa     constant uuid := 'eeeeeeee-0000-4000-8000-000000000003';
  old_acct constant uuid := 'eeeeeeee-0000-4000-8000-000000000004';
  v_chk    constant uuid := 'ffffffff-0000-4000-8000-000000000001';
  sched    constant uuid := 'eeeeeeee-0000-4000-8000-000000000011';
  card     constant uuid := 'eeeeeeee-0000-4000-8000-000000000012';
  d_now    constant date := current_date - 2;   -- counts on every account
  d1m      constant date := (current_date - 2 + interval '1 month')::date;
  d_sav    constant date := current_date - 10;  -- counts on checking, before savings' balance date
  groc     uuid;
  cc_cat   uuid;
  v_groc   uuid;
  goal     uuid;
  src      uuid;
  other    uuid;
  grp      uuid;
  imp      uuid;
  snap     jsonb;
  snap2    jsonb;
  chk0     numeric;
  sav0     numeric;
  visa0    numeric;
  st       text;
  msg      text;
  sav_set  timestamptz;
  v_src    uuid;
begin
  select id into groc   from public.categories where userid = u and category_name = 'Groceries';
  select id into cc_cat from public.categories where userid = u and category_type = 'Income'
   order by category_name limit 1;
  select id into v_groc from public.categories where userid = v and category_name = 'Groceries';

  perform pg_temp.become(v);
  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (v_chk, v, 'MT other checking', 'Checking', 100, current_date - 30);
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (v, v_chk, v_groc, 5, 'Expense', d_now, 'Other user''s')
  returning id into v_src;

  perform pg_temp.become(u);
  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (chk,      u, 'MT checking', 'Checking',    5000, current_date - 30),
         (sav,      u, 'MT savings',  'Savings',     1000, current_date - 5),
         (visa,     u, 'MT visa',     'Credit Card', -800, current_date - 30),
         (old_acct, u, 'MT old',      'Savings',        0, current_date - 30);
  update public.accounts set is_active = false where id = old_acct;
  select opening_set_at into sav_set from public.accounts where id = sav;

  chk0 := pg_temp.balance_of(chk);
  sav0 := pg_temp.balance_of(sav);
  visa0 := pg_temp.balance_of(visa);

  -- 1 -----------------------------------------------------------------
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, chk, groc, 150, 'Expense', d_now, 'ONLINE TRANSFER TO SAV')
  returning id into src;
  snap := pg_temp.snapshot(src);
  chk0 := pg_temp.balance_of(chk);

  grp := public.make_transfer(src, sav);
  perform pg_temp.rec('1 create: two legs in the group, neither with a category', '2 0',
    (select count(*) || ' ' || count(categoryid) from public.transactions where transfer_group_id = grp));
  perform pg_temp.rec('1 ... Expense on checking (the entry), Income on savings',
    'Expense ' || chk || ' | Income ' || sav,
    (select string_agg(transaction_type || ' ' || accountid, ' | ' order by transaction_type)
       from public.transactions where transfer_group_id = grp));
  perform pg_temp.rec('1 ... the created leg has the entry''s date, amount and description',
    d_now || ' 150.00 ONLINE TRANSFER TO SAV',
    (select transaction_date || ' ' || amount || ' ' || description from public.transactions
      where transfer_group_id = grp and id <> src));
  perform pg_temp.rec('1 ... the conversion is recorded: the entry, Groceries, the created leg', 'true',
    (select (source_transactionid = src and source_prior_categoryid = groc
             and created_transactionid is not null and joined_transactionid is null)::text
       from public.transfer_conversions where transfer_group_id = grp));
  perform pg_temp.rec_num('1 ... checking doesn''t move (the money had already left)', chk0, pg_temp.balance_of(chk));
  perform pg_temp.rec_num('1 ... savings rises by exactly the amount', sav0 + 150, pg_temp.balance_of(sav));

  -- 7 (undo after create) ---------------------------------------------
  perform public.undo_make_transfer(grp);
  perform pg_temp.rec('7 undo: the entry is back exactly (every column but updated_at)', snap::text,
    pg_temp.snapshot(src)::text);
  perform pg_temp.rec('7 ... the created leg and the record are gone', '0 0',
    (select count(*) from public.transactions where transfer_group_id = grp) || ' '
      || (select count(*) from public.transfer_conversions where transfer_group_id = grp));
  perform pg_temp.rec_num('7 ... savings as before', sav0, pg_temp.balance_of(sav));
  perform pg_temp.rec('7 ... a second undo finds nothing (P0002)', 'P0002',
    pg_temp.state_of(format('select public.undo_make_transfer(%L)', grp)));

  -- 2 -----------------------------------------------------------------
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, chk, groc, 40, 'Expense', d_sav, 'XFER')
  returning id into other;
  perform pg_temp.rec('2 a leg before SAVINGS'' balance date, no answer: refused', 'SRA01',
    pg_temp.state_of(format('select public.make_transfer(%L, %L)', other, sav)));
  perform pg_temp.rec('2 ... nothing changed: still plain, no record', 'true',
    (select (transfer_group_id is null and categoryid = groc)::text from public.transactions where id = other)
      || (select case when count(*) = 0 then '' else ' RECORD' end from public.transfer_conversions where source_transactionid = other));
  perform pg_temp.rec('2 a stale anchor: refused', 'SRA02',
    pg_temp.state_of(format('select public.make_transfer(%L, %L, null, true, %L)', other, sav, sav_set - interval '1 day')));
  grp := public.make_transfer(other, sav, null, true, sav_set);
  perform pg_temp.rec('2 the answer is on the savings leg, against savings'' own anchor', 'true true',
    (select (counts_despite_anchor is true)::text || ' ' || (anchor_answer_set_at = sav_set)::text
       from public.transactions where transfer_group_id = grp and accountid = sav));
  perform pg_temp.rec('2 ... and the entry, which its date already counts, carries none', 'true',
    (select (counts_despite_anchor is null)::text from public.transactions where id = other));
  perform pg_temp.rec_num('2 ... "No, add it": savings rises by the amount', sav0 + 40, pg_temp.balance_of(sav));
  perform public.undo_make_transfer(grp);

  -- 3 -----------------------------------------------------------------
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, chk, groc, 500, 'Expense', d_now, 'AUTOPAY VISA')
  returning id into src;
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, visa, cc_cat, 500, 'Income', d_now - 1, 'Visa payment by hand')
  returning id into other;
  snap := pg_temp.snapshot(src);
  snap2 := pg_temp.snapshot(other);
  chk0 := pg_temp.balance_of(chk);
  visa0 := pg_temp.balance_of(visa);

  grp := public.make_transfer(src, visa, other);
  perform pg_temp.rec('3 join: both entries are the legs, no categories', '2 0',
    (select count(*) || ' ' || count(categoryid) from public.transactions where transfer_group_id = grp));
  perform pg_temp.rec('3 ... each keeps its own day, amount and account', (d_now - 1) || ' ' || d_now || ' 1 2',
    (select string_agg(transaction_date::text, ' ' order by transaction_date) || ' ' || count(distinct amount) || ' ' || count(distinct accountid)
       from public.transactions where transfer_group_id = grp));
  perform pg_temp.rec('3 ... both categories recorded', groc || ' ' || cc_cat,
    (select source_prior_categoryid || ' ' || joined_prior_categoryid from public.transfer_conversions where transfer_group_id = grp));
  perform pg_temp.rec_num('3 ... checking doesn''t move', chk0, pg_temp.balance_of(chk));
  perform pg_temp.rec_num('3 ... the Visa doesn''t move', visa0, pg_temp.balance_of(visa));

  -- 8 (undo after join) -----------------------------------------------
  perform public.undo_make_transfer(grp);
  perform pg_temp.rec('8 undo: the entry is back exactly', snap::text, pg_temp.snapshot(src)::text);
  perform pg_temp.rec('8 ... the joined entry is back exactly', snap2::text, pg_temp.snapshot(other)::text);

  -- 4 -----------------------------------------------------------------
  grp := public.make_transfer(src, visa, other);
  perform pg_temp.rec('4 refused: already a transfer leg', 'SMT01',
    pg_temp.state_of(format('select public.make_transfer(%L, %L)', src, sav)));
  perform public.undo_make_transfer(grp);

  insert into public.recurring_transactions
    (id, userid, accountid, to_accountid, description, amount, frequency, next_run_date, start_date, next_due_date)
  values (sched, u, chk, sav, 'MT schedule', 500, 'Monthly', current_date + 20, current_date + 20, current_date + 20);
  perform pg_temp.unbecome();
  update public.transactions set recurringid = sched where id = src;
  perform pg_temp.become(u);
  perform pg_temp.rec('4 refused: confirmed from a schedule', 'SMT01',
    pg_temp.state_of(format('select public.make_transfer(%L, %L)', src, sav)));
  perform pg_temp.unbecome();
  update public.transactions set recurringid = null where id = src;
  insert into public.same_bill_answers (userid, recurringid, transactionid, answer, occurrence_due_date)
  values (u, sched, src, 'different', current_date + 20);
  perform pg_temp.become(u);
  perform pg_temp.rec('4 refused: carries a same-bill answer', 'SMT01',
    pg_temp.state_of(format('select public.make_transfer(%L, %L)', src, sav)));
  perform pg_temp.unbecome();
  delete from public.same_bill_answers where transactionid = src;
  perform pg_temp.become(u);
  perform pg_temp.rec('4 refused: the same account', 'SMT01',
    pg_temp.state_of(format('select public.make_transfer(%L, %L)', src, chk)));
  perform pg_temp.rec('4 refused: an archived account', 'SMT01',
    pg_temp.state_of(format('select public.make_transfer(%L, %L)', src, old_acct)));
  perform pg_temp.rec('4 refused: another user''s account, like a made-up one', 'P0002 P0002',
    pg_temp.state_of(format('select public.make_transfer(%L, %L)', src, v_chk)) || ' '
      || pg_temp.state_of(format('select public.make_transfer(%L, %L)', src, gen_random_uuid())));
  perform pg_temp.rec('4 refused: another user''s entry, like a made-up one', 'P0002 P0002',
    pg_temp.state_of(format('select public.make_transfer(%L, %L)', v_src, sav)) || ' '
      || pg_temp.state_of(format('select public.make_transfer(%L, %L)', gen_random_uuid(), sav)));
  perform pg_temp.rec('4 ... nothing was recorded', '0',
    (select count(*)::text from public.transfer_conversions where userid = u));

  -- 5 -----------------------------------------------------------------
  for st, msg in
    select * from (values
      ('the same direction',
       format('update public.transactions set transaction_type = ''Expense'', categoryid = %L where id = %L', groc, other)),
      ('a cent off',
       format('update public.transactions set amount = 500.01 where id = %L', other)),
      ('6 days off',
       format('update public.transactions set transaction_date = %L where id = %L', d_now - 6, other)),
      ('on a schedule',
       format('update public.transactions set recurringid = %L where id = %L', sched, other))
    ) as t(what, change)
  loop
    perform pg_temp.unbecome();
    alter table public.transactions disable trigger trg_transactions_anchor_answer;
    execute msg;
    alter table public.transactions enable trigger trg_transactions_anchor_answer;
    perform pg_temp.become(u);
    perform pg_temp.rec('5 refused to join ' || st, 'SMT02',
      pg_temp.state_of(format('select public.make_transfer(%L, %L, %L)', src, visa, other)));
    perform pg_temp.unbecome();
    alter table public.transactions disable trigger trg_transactions_anchor_answer;
    update public.transactions
       set recurringid = null, transaction_type = 'Income', categoryid = cc_cat, amount = 500,
           transaction_date = d_now - 1
     where id = other;
    alter table public.transactions enable trigger trg_transactions_anchor_answer;
    perform pg_temp.become(u);
  end loop;
  perform pg_temp.rec('5 refused to join an entry not on the chosen account', 'SMT02',
    pg_temp.state_of(format('select public.make_transfer(%L, %L, %L)', src, sav, other)));
  perform pg_temp.rec('5 ... both entries still plain', '0',
    (select count(*)::text from public.transactions where id in (src, other) and transfer_group_id is not null));

  -- 6 -----------------------------------------------------------------
  insert into public.goals (userid, goal_name, goal_type, target_amount)
  values (u, 'MT goal', 'Custom', 10000) returning id into goal;
  update public.transactions set goalid = goal where id = src;
  grp := public.make_transfer(src, visa, other);
  perform pg_temp.rec('6 an Expense entry with a goal becomes the Expense leg and keeps its goal', goal::text,
    (select goalid::text from public.transactions where transfer_group_id = grp and transaction_type = 'Expense'));
  perform public.undo_make_transfer(grp);
  update public.transactions set goalid = null where id = src;
  -- (An Income entry with a goal can't exist -- transactions_goal_expense_only
  -- -- so the "Unlink it from <goal> first." refusal holds by construction;
  -- the function checks it anyway.)

  -- 9 -----------------------------------------------------------------
  grp := public.make_transfer(src, sav);
  perform public.update_transfer(p_transfer_group_id => grp, p_from_accountid => chk, p_to_accountid => sav,
    p_amount => 175, p_transaction_date => d_now, p_description => 'Edited', p_notes => null);
  perform public.undo_make_transfer(grp);
  perform pg_temp.rec('9 undo after an edit: the edit is kept, the category restored, not a leg', '175.00 Edited ' || groc || ' true',
    (select amount || ' ' || description || ' ' || categoryid || ' ' || (transfer_group_id is null)::text
       from public.transactions where id = src));
  perform pg_temp.rec_num('9 ... savings as before (the created leg is gone)', sav0, pg_temp.balance_of(sav));

  grp := public.make_transfer(src, sav);
  -- Swap from and to: update_transfer() moves the ACCOUNTS (the Expense
  -- leg is always the source), never a row's type, so the entry's
  -- category still fits and the swap is an edit like any other: kept.
  perform public.update_transfer(p_transfer_group_id => grp, p_from_accountid => sav, p_to_accountid => chk,
    p_amount => 175, p_transaction_date => d_now, p_description => 'Edited', p_notes => null);
  perform public.undo_make_transfer(grp);
  perform pg_temp.rec('9 undo after a swap: the entry keeps the swapped account, back in Groceries', sav || ' Expense ' || groc,
    (select accountid || ' ' || transaction_type || ' ' || categoryid from public.transactions where id = src));
  -- A type that no longer fits its old category (only a service-role fix
  -- can make one) refuses rather than guessing a category.
  grp := public.make_transfer(src, chk);
  perform pg_temp.unbecome();
  perform set_config('sorrel.transfer_edit', 'on', true);
  update public.transactions set transaction_type = case transaction_type when 'Expense' then 'Income' else 'Expense' end
   where transfer_group_id = grp;
  perform set_config('sorrel.transfer_edit', '', true);
  perform pg_temp.become(u);
  perform pg_temp.rec('9 a type that no longer fits its category: refused', 'SMT03',
    pg_temp.state_of(format('select public.undo_make_transfer(%L)', grp)));
  perform pg_temp.rec('9 ... and nothing changed: still a transfer, still recorded', '2 1',
    (select count(*) from public.transactions where transfer_group_id = grp) || ' '
      || (select count(*) from public.transfer_conversions where transfer_group_id = grp));
  perform pg_temp.unbecome();
  perform set_config('sorrel.transfer_edit', 'on', true);
  update public.transactions set transaction_type = case transaction_type when 'Expense' then 'Income' else 'Expense' end
   where transfer_group_id = grp;
  perform set_config('sorrel.transfer_edit', '', true);
  perform pg_temp.become(u);
  perform public.undo_make_transfer(grp);
  -- Back on checking for what follows.
  perform pg_temp.unbecome();
  update public.transactions set accountid = chk where id = src;
  perform pg_temp.become(u);

  -- 10 ----------------------------------------------------------------
  chk0 := pg_temp.balance_of(chk);
  sav0 := pg_temp.balance_of(sav);
  imp := (select out_import_id from public.import_transactions(chk, jsonb_build_array(
    pg_temp.r(2, d_now, 6000, 'Expense', 'TFR TO SAV', groc),
    pg_temp.r(3, d_now, 1200, 'Expense', 'MT SHOP', groc)), null, null));
  select id into src from public.transactions where import_id = imp and amount = 60;
  -- list_imports()' "edited since" (migration 81). The whole script is one
  -- transaction, so every now() is the same instant: the import has to be
  -- aged by hand. Two triggers stand in the way of a plain UPDATE --
  -- trg_transactions_created_at (migration 48) puts created_at back, and
  -- trg_transactions_updated_at (baseline) sets updated_at to now() -- so
  -- the owner switches both off for this one statement, as
  -- balance-anchor-test.sql does, inside the rolled-back transaction.
  -- Both rows then read as imported an hour ago and never touched.
  perform pg_temp.unbecome();
  alter table public.transactions disable trigger trg_transactions_created_at;
  alter table public.transactions disable trigger trg_transactions_updated_at;
  update public.transactions
     set created_at = now() - interval '1 hour', updated_at = now() - interval '1 hour'
   where import_id = imp;
  alter table public.transactions enable trigger trg_transactions_updated_at;
  alter table public.transactions enable trigger trg_transactions_created_at;
  perform pg_temp.become(u);
  perform pg_temp.rec('10 list_imports: an import nobody touched has no edits', '0',
    (select edited_count::text from public.list_imports() where import_id = imp));
  grp := public.make_transfer(src, sav);
  -- Migration 76's rule (updated_at past created_at) said 1 here.
  perform pg_temp.rec('10 converting a row isn''t an edit', '0',
    (select edited_count::text from public.list_imports() where import_id = imp));
  -- An ordinary edit to the import's other row still counts.
  update public.transactions set notes = 'MT edited' where import_id = imp and id <> src;
  perform pg_temp.rec('10 ... an ordinary edit to another row still counts', '1',
    (select edited_count::text from public.list_imports() where import_id = imp));
  -- An edit to the converted row AFTER the conversion still counts: age
  -- the conversion half an hour (no trigger guards its created_at), so the
  -- row's updated_at is past it.
  perform pg_temp.unbecome();
  update public.transfer_conversions set created_at = now() - interval '30 minutes' where transfer_group_id = grp;
  perform pg_temp.become(u);
  perform pg_temp.rec('10 ... an edit after the conversion still counts', '2',
    (select edited_count::text from public.list_imports() where import_id = imp));
  perform pg_temp.rec('10 the dialog''s count: one conversion made from this import''s rows', '1',
    public.undo_import_conversions(imp)::text);
  perform pg_temp.rec('10 undo_import deletes the import''s two rows', '2',
    (select out_deleted::text from public.undo_import(imp)));
  perform pg_temp.rec('10 ... the conversion was reversed first: no leg, no record left', '0 0',
    (select count(*) from public.transactions where transfer_group_id = grp) || ' '
      || (select count(*) from public.transfer_conversions where transfer_group_id = grp));
  perform pg_temp.rec_num('10 ... checking as before', chk0, pg_temp.balance_of(chk));
  perform pg_temp.rec_num('10 ... savings as before', sav0, pg_temp.balance_of(sav));

  -- 11 ----------------------------------------------------------------
  -- An import into the Visa: a payment, imported as income.
  imp := (select out_import_id from public.import_transactions(visa, jsonb_build_array(
    pg_temp.r(2, d_now, 30000, 'Income', 'PAYMENT THANK YOU', cc_cat)), null, null));
  select id into other from public.transactions where import_id = imp;
  -- The checking side, typed by hand, then turned into a transfer by
  -- joining the imported row.
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, chk, groc, 300, 'Expense', d_now, 'VISA PMT')
  returning id into src;
  grp := public.make_transfer(src, visa, other);
  st := pg_temp.state_of(format('select * from public.undo_import(%L)', imp));
  msg := pg_temp.message_of(format('select * from public.undo_import(%L)', imp));
  perform pg_temp.rec('11 undo_import refused while a conversion joined its row', 'SIU02', st);
  perform pg_temp.rec('11 ... naming the transfer''s date', 'Separate the transfer from ' || to_char(d_now, 'YYYY-MM-DD') || ' first.', msg);
  perform pg_temp.rec('11 ... and nothing changed', '2 1',
    (select count(*) from public.transactions where transfer_group_id = grp) || ' '
      || (select count(*) from public.imports where id = imp));
  perform public.undo_make_transfer(grp);
  perform pg_temp.rec('11 after Undo, undo_import goes through', '1',
    (select out_deleted::text from public.undo_import(imp)));
  perform pg_temp.rec('11 ... the hand entry is back in Groceries', groc::text,
    (select categoryid::text from public.transactions where id = src));
  delete from public.transactions where id = src;

  -- 12 ----------------------------------------------------------------
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, visa, cc_cat, 250, 'Income', d_now - 1, 'Visa by hand')
  returning id into other;
  snap2 := pg_temp.snapshot(other);
  visa0 := pg_temp.balance_of(visa);
  chk0 := pg_temp.balance_of(chk);
  imp := (select out_import_id from public.import_transactions(chk, jsonb_build_array(
    pg_temp.r(2, d_now, 25000, 'Expense', 'AUTOPAY', null, jsonb_build_object('other_accountid', visa, 'pair_with', other)),
    pg_temp.r(3, d_now, 900, 'Expense', 'MT CAFE', groc)), null, null));
  select transfer_group_id into grp from public.transactions where id = other;
  select id into src from public.transactions where transfer_group_id = grp and id <> other;
  perform pg_temp.rec('12 separate without a category for the imported side: refused', 'SMT04',
    pg_temp.state_of(format('select public.separate_import_transfer(%L, null)', grp)));
  perform pg_temp.rec('12 ... with an income category for a spending row: refused', 'SMT04',
    pg_temp.state_of(format('select public.separate_import_transfer(%L, %L)', grp, cc_cat)));
  perform pg_temp.rec('12 ... with another user''s category: refused like a missing one', 'SMT04',
    pg_temp.state_of(format('select public.separate_import_transfer(%L, %L)', grp, v_groc)));
  perform pg_temp.rec('12 ... and nothing changed: still a transfer, still paired', '2 1',
    (select count(*) from public.transactions where transfer_group_id = grp) || ' '
      || (select count(*) from public.import_pairings where transactionid = other));
  perform public.separate_import_transfer(grp, groc);
  perform pg_temp.rec('12 separate: the entry is back exactly as before the import', snap2::text,
    pg_temp.snapshot(other)::text);
  perform pg_temp.rec('12 ... the imported side is KEPT, on its own, in the chosen category, still the import''s',
    'true ' || groc || ' ' || imp,
    (select (transfer_group_id is null)::text || ' ' || categoryid || ' ' || import_id from public.transactions where id = src));
  perform pg_temp.rec('12 ... no leg and no pairing left', '0 0',
    (select count(*) from public.transactions where transfer_group_id = grp) || ' '
      || (select count(*) from public.import_pairings where transactionid = other));
  perform pg_temp.rec_num('12 ... the Visa doesn''t move', visa0, pg_temp.balance_of(visa));
  perform pg_temp.rec_num('12 ... checking doesn''t move either: both file rows stay', chk0 - 259, pg_temp.balance_of(chk));
  perform pg_temp.rec('12 ... a second separate finds nothing (P0002)', 'P0002',
    pg_temp.state_of(format('select public.separate_import_transfer(%L, %L)', grp, groc)));
  perform pg_temp.rec('12 undo_import afterwards removes both file rows and leaves the entry', '2 1',
    (select out_deleted::text from public.undo_import(imp)) || ' '
      || (select count(*) from public.transactions where id = other));

  -- 13 ----------------------------------------------------------------
  perform pg_temp.unbecome();
  update public.transactions set recurringid = sched where id = other;
  perform pg_temp.become(u);
  perform pg_temp.rec('13 the import''s join refuses a scheduled entry through the shared check', 'SIP01',
    pg_temp.state_of(format('select public.import_transactions(%L, %L::jsonb, null, null)', chk,
      jsonb_build_array(pg_temp.r(2, d_now, 25000, 'Expense', 'AUTOPAY', null,
        jsonb_build_object('other_accountid', visa, 'pair_with', other)))::text)));
  perform pg_temp.unbecome();
  update public.transactions set recurringid = null where id = other;
  perform pg_temp.become(u);

  -- 15 ----------------------------------------------------------------
  -- A scheduled card payment, checking -> Visa, waiting in the queue on
  -- d_now; the same payment typed by hand as spending, then turned into a
  -- transfer to the Visa.
  insert into public.recurring_transactions
    (id, userid, accountid, to_accountid, description, amount, frequency, next_run_date, start_date, next_due_date)
  values (card, u, chk, visa, 'MT card payment', 120, 'Monthly', d_now, d_now, d_now);
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, chk, groc, 120, 'Expense', d_now, 'CAPITAL ONE MOBILE PMT')
  returning id into src;
  visa0 := pg_temp.balance_of(visa);

  perform pg_temp.rec('15 a join can''t also answer the bill', 'SMT02',
    pg_temp.state_of(format('select public.make_transfer(%L, %L, %L, null, null, %L::jsonb)', src, visa, other,
      jsonb_build_object('recurringid', card, 'from_run_date', d_now, 'to_run_date', d1m, 'to_due_date', d1m)::text)));
  perform pg_temp.rec('15 a stale occurrence: refused', 'SMT05',
    pg_temp.state_of(format('select public.make_transfer(%L, %L, null, null, null, %L::jsonb)', src, visa,
      jsonb_build_object('recurringid', card, 'from_run_date', d_now - 31, 'to_run_date', d1m, 'to_due_date', d1m)::text)));
  perform pg_temp.rec('15 ... nothing changed', 'true',
    (select (transfer_group_id is null and recurringid is null)::text from public.transactions where id = src));

  grp := public.make_transfer(src, visa, null, null, null,
    jsonb_build_object('recurringid', card, 'from_run_date', d_now, 'to_run_date', d1m, 'to_due_date', d1m));
  perform pg_temp.rec('15 "Yes, the same": both legs linked to the schedule', '2',
    (select count(*)::text from public.transactions where transfer_group_id = grp and recurringid = card));
  perform pg_temp.rec('15 ... the schedule stepped past the occurrence', d1m::text,
    (select next_run_date::text from public.recurring_transactions where id = card));
  perform pg_temp.rec_num('15 ... the Visa owes the payment less, once', visa0 + 120, pg_temp.balance_of(visa));
  perform public.undo_make_transfer(grp);
  perform pg_temp.rec('15 Undo: the occurrence is back on the schedule', d_now::text,
    (select next_run_date::text from public.recurring_transactions where id = card));
  perform pg_temp.rec('15 ... the entry is plain again: no leg, no schedule, no answer', 'true 0',
    (select (transfer_group_id is null and recurringid is null and categoryid = groc)::text from public.transactions where id = src)
      || ' ' || (select count(*) from public.same_bill_answers where recurringid = card));
  perform pg_temp.rec_num('15 ... the Visa as before', visa0, pg_temp.balance_of(visa));

  grp := public.make_transfer(src, visa, null, null, null, null,
    jsonb_build_object('recurringid', card, 'due_date', d_now));
  perform pg_temp.rec('15 "No, keep both": remembered on the transfer, the schedule untouched', '1 ' || d_now,
    (select count(*)::text from public.same_bill_answers where recurringid = card and answer = 'different') || ' '
      || (select next_run_date from public.recurring_transactions where id = card));
  perform public.undo_make_transfer(grp);
  perform pg_temp.rec('15 ... Undo forgets that answer too', '0',
    (select count(*)::text from public.same_bill_answers where recurringid = card));
  delete from public.transactions where id = src;

  -- 14 ----------------------------------------------------------------
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, chk, groc, 20, 'Expense', d_now, 'MT to delete')
  returning id into src;
  grp := public.make_transfer(src, sav);
  delete from public.transactions where transfer_group_id = grp;
  perform pg_temp.rec('14 deleting the transfer leaves no record', '0',
    (select count(*)::text from public.transfer_conversions where transfer_group_id = grp));
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, chk, groc, 21, 'Expense', d_now, 'MT kept')
  returning id into src;
  grp := public.make_transfer(src, sav);
  perform public.delete_own_account();
  perform pg_temp.unbecome();
  perform pg_temp.rec('14 delete_own_account() leaves no conversion or transaction', '0 0',
    (select (select count(*) from public.transfer_conversions where userid = u)::text || ' '
            || (select count(*) from public.transactions where userid = u)::text));
end
$$;

-- The summary is the LAST row. A run counts as passed only when it says
-- ALL PASS (CLAUDE.md): every row true AND every numbered section present.
-- A run that errors part-way returns no rows at all.
with expected(s) as (select unnest(array['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15'])),
tally as (
  select (select count(*) from mt_results)                as total,
         (select count(*) from mt_results where not pass) as failed,
         (select string_agg(e.s, ', ' order by e.s::int) from expected e
           where not exists (select 1 from mt_results r where split_part(r.check_, ' ', 1) = e.s)) as missing
)
select check_ as check, expected, actual, pass
  from (select seq, check_, expected, actual, pass from mt_results
        union all
        select 2147483647, 'SUMMARY', 'ALL PASS (every row true, sections 1-15 present)',
               t.total || ' rows, ' || t.failed || ' false'
                 || coalesce(', missing sections: ' || t.missing, '')
                 || ' -- ' || case when t.failed = 0 and t.missing is null then 'ALL PASS' else 'NOT PASSED' end,
               t.failed = 0 and t.missing is null
          from tally t) x
 order by seq;

rollback;
