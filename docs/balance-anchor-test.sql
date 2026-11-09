-- =====================================================================
-- Balance anchor test (migrations 48, 62)
--
-- Run against the linked project after any change to anchor_includes(),
-- v_account_balances, the anchor triggers or their readers:
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/balance-anchor-test.sql
--
-- One row per assertion (section, check, expected, actual, pass). A run
-- is clean only when every `pass` is true.
--
-- Self-cleaning, like docs/rls-isolation-test.sql: ONE transaction
-- ending in ROLLBACK, one throwaway user, nothing committed. Fixture ids
-- are fixed, so a run that was ever committed fails the next one loudly.
-- Cleanup check after a run (must be 0):
--   select count(*) from auth.users where email like 'anchor-test-%@example.invalid';
--
-- Within one transaction now() never moves, so the triggers would stamp
-- every row with the same instant. Section 3 therefore writes its times
-- as the table owner with the timestamp triggers disabled -- inside this
-- transaction only -- and section 2 checks the triggers themselves.
--
-- Sections
--   1  The rule      anchor_includes() truth table
--   2  Triggers      created_at and opening_set_at are the database's
--   3  Balances      v_account_balances, counts_toward_balance and
--                    balance_anchor_preview agree on the scenarios that
--                    motivated the rule
--   4  Answers       a pre-anchor transaction needs an answer (migration
--                    62); "No" moves the balance by exactly its amount,
--                    once; "Yes" doesn't; a new balance voids earlier
--                    answers
-- =====================================================================

begin;

create temp table anchor_results (
  seq      serial primary key,
  section  text not null,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
-- Assertions are recorded while impersonating the user.
grant insert on anchor_results to authenticated;
grant usage on sequence anchor_results_seq_seq to authenticated;

create function pg_temp.rec(p_section text, p_check text, p_expected text, p_actual text)
returns void language sql as $$
  insert into anchor_results (section, check_, expected, actual, pass)
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

-- Runs a statement and returns its SQLSTATE, or null if it succeeded. A
-- failed statement rolls back to its own savepoint, not the whole run.
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end
$$;


-- ---------------------------------------------------------------------
-- 1. The rule
-- ---------------------------------------------------------------------
insert into anchor_results (section, check_, expected, actual, pass)
select '1 rule', v.what, v.expected::text, r::text, r = v.expected
  from (values
    ('after the date, recorded before the anchor',  date '2026-10-11', timestamptz '2026-10-10 12:00Z', true),
    ('before the date, recorded after the anchor',  date '2026-10-09', timestamptz '2026-10-10 18:00Z', false),
    ('on the date, recorded before the anchor',     date '2026-10-10', timestamptz '2026-10-10 12:00Z', false),
    ('on the date, recorded after the anchor',      date '2026-10-10', timestamptz '2026-10-10 18:00Z', true),
    ('on the date, recorded at the anchor instant', date '2026-10-10', timestamptz '2026-10-10 17:00Z', false)
  ) as v(what, txn_date, recorded, expected)
 cross join lateral (
   select public.anchor_includes(v.txn_date, v.recorded, date '2026-10-10', timestamptz '2026-10-10 17:00Z',
                                 null, null) as r
 ) x;

insert into anchor_results (section, check_, expected, actual, pass)
select '1 rule', v.what, v.expected::text, r::text, r = v.expected
  from (values
    ('before the date, answered No for this anchor',     true,  timestamptz '2026-10-10 17:00Z', true),
    ('before the date, answered No for an older anchor', true,  timestamptz '2026-10-01 09:00Z', false),
    ('before the date, answered Yes for this anchor',    false, timestamptz '2026-10-10 17:00Z', false)
  ) as v(what, counts, answer_set_at, expected)
 cross join lateral (
   select public.anchor_includes(date '2026-10-09', timestamptz '2026-10-10 18:00Z',
                                 date '2026-10-10', timestamptz '2026-10-10 17:00Z',
                                 v.counts, v.answer_set_at) as r
 ) x;


-- ---------------------------------------------------------------------
-- Fixture: one user, one Checking account anchored 2026-10-10 at $1000
-- ---------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a7c4a7c4-a7c4-4a7c-8a7c-a7c4a7c4a7c4', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'anchor-test-a@example.invalid', '{}'::jsonb,
        '{"first_name": "Anchor"}'::jsonb, now(), now());

select pg_temp.become('a7c4a7c4-a7c4-4a7c-8a7c-a7c4a7c4a7c4');

insert into public.accounts (id, userid, account_name, account_type,
                             opening_balance, opening_date, opening_set_at)
values ('a7c4a7c4-0000-4000-8000-000000000001', 'a7c4a7c4-a7c4-4a7c-8a7c-a7c4a7c4a7c4',
        'Anchor checking', 'Checking', 1000, date '2026-10-10',
        timestamptz '2000-01-01Z');  -- a client's value: the trigger must ignore it

insert into public.transactions (id, userid, accountid, categoryid, description,
                                 amount, transaction_type, transaction_date, created_at)
select 'a7c4a7c4-0000-4000-8000-0000000000a1', 'a7c4a7c4-a7c4-4a7c-8a7c-a7c4a7c4a7c4',
       'a7c4a7c4-0000-4000-8000-000000000001', c.id, 'forged created_at',
       1, 'Expense', date '2026-10-12', timestamptz '2000-01-01Z'
  from public.categories c
 where c.userid = 'a7c4a7c4-a7c4-4a7c-8a7c-a7c4a7c4a7c4' and c.category_name = 'Groceries';


-- ---------------------------------------------------------------------
-- 2. Triggers
-- ---------------------------------------------------------------------
select pg_temp.rec('2 triggers', 'insert: opening_set_at is now(), not the client''s value',
  now()::text, (select opening_set_at::text from public.accounts
                 where id = 'a7c4a7c4-0000-4000-8000-000000000001'));

select pg_temp.rec('2 triggers', 'insert: created_at is now(), not the client''s value',
  now()::text, (select created_at::text from public.transactions
                 where id = 'a7c4a7c4-0000-4000-8000-0000000000a1'));

-- Move both stamps into the past as the owner, so "unchanged" and
-- "re-stamped" can be told apart from now().
select pg_temp.unbecome();
alter table public.accounts disable trigger trg_accounts_anchor_1_lock;
alter table public.transactions disable trigger trg_transactions_created_at;
update public.accounts set opening_set_at = timestamptz '2026-10-10 21:00Z'
 where id = 'a7c4a7c4-0000-4000-8000-000000000001';
update public.transactions set created_at = timestamptz '2026-10-12 15:00Z'
 where id = 'a7c4a7c4-0000-4000-8000-0000000000a1';
alter table public.accounts enable trigger trg_accounts_anchor_1_lock;
alter table public.transactions enable trigger trg_transactions_created_at;
select pg_temp.become('a7c4a7c4-a7c4-4a7c-8a7c-a7c4a7c4a7c4');

update public.accounts set account_name = 'Anchor checking (renamed)'
 where id = 'a7c4a7c4-0000-4000-8000-000000000001';
select pg_temp.rec('2 triggers', 'rename: opening_set_at unchanged',
  (timestamptz '2026-10-10 21:00Z')::text,
  (select opening_set_at::text from public.accounts where id = 'a7c4a7c4-0000-4000-8000-000000000001'));

update public.accounts set opening_set_at = timestamptz '2000-01-01Z'
 where id = 'a7c4a7c4-0000-4000-8000-000000000001';
select pg_temp.rec('2 triggers', 'client writes opening_set_at: ignored',
  (timestamptz '2026-10-10 21:00Z')::text,
  (select opening_set_at::text from public.accounts where id = 'a7c4a7c4-0000-4000-8000-000000000001'));

update public.transactions set created_at = timestamptz '2000-01-01Z', notes = 'edited'
 where id = 'a7c4a7c4-0000-4000-8000-0000000000a1';
select pg_temp.rec('2 triggers', 'client writes created_at: ignored',
  (timestamptz '2026-10-12 15:00Z')::text,
  (select created_at::text from public.transactions where id = 'a7c4a7c4-0000-4000-8000-0000000000a1'));

-- Posting the anchor re-sets it, even with the same values.
update public.accounts set opening_balance = 1000, opening_date = date '2026-10-10'
 where id = 'a7c4a7c4-0000-4000-8000-000000000001';
select pg_temp.rec('2 triggers', 'anchor posted unchanged: opening_set_at re-stamped',
  now()::text,
  (select opening_set_at::text from public.accounts where id = 'a7c4a7c4-0000-4000-8000-000000000001'));


-- ---------------------------------------------------------------------
-- 3. Balances
--
-- Anchor: 2026-10-10, set at 17:00Z ("5pm, from the bank app").
--   b1  dated 10-10, logged 12:00Z (noon, before the anchor)  $10  out
--   b2  dated 10-10, logged 18:00Z (after the anchor)         $20  in
--   b3  dated 10-11, logged 09:00Z on 10-10                   $40  in
--   b4  dated 10-09, logged 10-11 (backdated)                 $80  out
--   b5  dated 10-08, logged 12:30Z on 10-10                  $160  out
-- ---------------------------------------------------------------------
select pg_temp.unbecome();
alter table public.accounts disable trigger trg_accounts_anchor_1_lock;
alter table public.transactions disable trigger trg_transactions_created_at;
-- b1, b4 and b5 are dated before the anchor with no answer: rows from
-- before migration 62, so its answer trigger is off for this insert too.
alter table public.transactions disable trigger trg_transactions_anchor_answer;
delete from public.transactions where id = 'a7c4a7c4-0000-4000-8000-0000000000a1';
update public.accounts set opening_set_at = timestamptz '2026-10-10 17:00Z'
 where id = 'a7c4a7c4-0000-4000-8000-000000000001';
insert into public.transactions (id, userid, accountid, categoryid, description,
                                 amount, transaction_type, transaction_date, created_at)
select v.id::uuid, 'a7c4a7c4-a7c4-4a7c-8a7c-a7c4a7c4a7c4', 'a7c4a7c4-0000-4000-8000-000000000001',
       c.id, v.what, v.amount, 'Expense', v.d, v.at
  from (values
    ('a7c4a7c4-0000-4000-8000-0000000000b1', 'b1', 10,  date '2026-10-10', timestamptz '2026-10-10 12:00Z'),
    ('a7c4a7c4-0000-4000-8000-0000000000b2', 'b2', 20,  date '2026-10-10', timestamptz '2026-10-10 18:00Z'),
    ('a7c4a7c4-0000-4000-8000-0000000000b3', 'b3', 40,  date '2026-10-11', timestamptz '2026-10-10 09:00Z'),
    ('a7c4a7c4-0000-4000-8000-0000000000b4', 'b4', 80,  date '2026-10-09', timestamptz '2026-10-11 09:00Z'),
    ('a7c4a7c4-0000-4000-8000-0000000000b5', 'b5', 160, date '2026-10-08', timestamptz '2026-10-10 12:30Z')
  ) as v(id, what, amount, d, at)
 cross join public.categories c
 where c.userid = 'a7c4a7c4-a7c4-4a7c-8a7c-a7c4a7c4a7c4' and c.category_name = 'Groceries';
alter table public.accounts enable trigger trg_accounts_anchor_1_lock;
alter table public.transactions enable trigger trg_transactions_created_at;
alter table public.transactions enable trigger trg_transactions_anchor_answer;
select pg_temp.become('a7c4a7c4-a7c4-4a7c-8a7c-a7c4a7c4a7c4');

-- 1000 - 20 (b2) - 40 (b3)
select pg_temp.rec('3 balances', 'noon purchase before a 5pm anchor is not counted twice',
  '940.00', (select balance::text from public.v_account_balances
              where account_id = 'a7c4a7c4-0000-4000-8000-000000000001'));

select pg_temp.rec('3 balances', 'counts_toward_balance agrees with the view, row by row',
  'b2,b3', (select string_agg(t.description, ',' order by t.description)
              from public.transactions t
             where t.accountid = 'a7c4a7c4-0000-4000-8000-000000000001'
               and public.counts_toward_balance(t)));

-- Edit b5's date onto the anchor date: logged before the anchor, so it
-- still wouldn't count -- and since migration 62 that edit needs an answer.
select pg_temp.rec('3 balances', 'date edited onto the anchor date, logged before it, no answer: refused',
  'SRA01', pg_temp.sqlstate_of($q$update public.transactions set transaction_date = date '2026-10-10'
                                  where id = 'a7c4a7c4-0000-4000-8000-0000000000b5'$q$));
select pg_temp.rec('3 balances', 'preview for that edit: not counted by date',
  'false', (select counts_by_date::text from public.balance_anchor_preview(
              'a7c4a7c4-0000-4000-8000-000000000001', date '2026-10-10',
              'a7c4a7c4-0000-4000-8000-0000000000b5')));
select pg_temp.rec('3 balances', 'preview, new transaction on the anchor date: counts',
  'true', (select counts_by_date::text from public.balance_anchor_preview(
             'a7c4a7c4-0000-4000-8000-000000000001', date '2026-10-10')));
select pg_temp.rec('3 balances', 'preview, new transaction before the anchor date: not counted',
  'false', (select counts_by_date::text from public.balance_anchor_preview(
              'a7c4a7c4-0000-4000-8000-000000000001', date '2026-10-09')));
select pg_temp.rec('3 balances', 'preview names the anchor it would ask about',
  '1000.00 2026-10-10 2026-10-10 17:00:00+00',
  (select concat_ws(' ', anchor_balance, anchor_date, anchor_set_at at time zone 'UTC' || '+00')
     from public.balance_anchor_preview('a7c4a7c4-0000-4000-8000-000000000001', date '2026-10-09')));
select pg_temp.rec('3 balances', 'an edit that touches nothing the rule reads: allowed, still out',
  'null false', (select coalesce(pg_temp.sqlstate_of($q$update public.transactions set notes = 'n'
                                   where id = 'a7c4a7c4-0000-4000-8000-0000000000b4'$q$), 'null')
                   || ' ' || (select public.counts_toward_balance(t)::text from public.transactions t
                               where t.id = 'a7c4a7c4-0000-4000-8000-0000000000b4')));

-- Re-set the anchor later the same day (21:00Z): b2 (18:00Z) is now in the figure.
select pg_temp.unbecome();
alter table public.accounts disable trigger trg_accounts_anchor_1_lock;
alter table public.accounts disable trigger trg_accounts_anchor_2_stamp;
update public.accounts set opening_set_at = timestamptz '2026-10-10 21:00Z', opening_balance = 950
 where id = 'a7c4a7c4-0000-4000-8000-000000000001';
alter table public.accounts enable trigger trg_accounts_anchor_1_lock;
alter table public.accounts enable trigger trg_accounts_anchor_2_stamp;
select pg_temp.become('a7c4a7c4-a7c4-4a7c-8a7c-a7c4a7c4a7c4');

-- 950 - 40 (b3)
select pg_temp.rec('3 balances', 'anchor re-set later the same day: earlier same-day entries drop out',
  '910.00', (select balance::text from public.v_account_balances
              where account_id = 'a7c4a7c4-0000-4000-8000-000000000001'));

select pg_temp.rec('3 balances', 'backdated before the anchor date: never counted',
  'false', (select public.counts_toward_balance(t)::text from public.transactions t
             where t.id = 'a7c4a7c4-0000-4000-8000-0000000000b4'));

select pg_temp.unbecome();


-- ---------------------------------------------------------------------
-- 4. Answers (migration 62)
--
-- The anchor is now 2026-10-10, set 21:00Z, $950; the balance is 910.00.
-- ---------------------------------------------------------------------
select pg_temp.become('a7c4a7c4-a7c4-4a7c-8a7c-a7c4a7c4a7c4');

create function pg_temp.insert_c(p_id text, p_what text, p_amount numeric, p_date date,
                                 p_counts boolean, p_set_at timestamptz)
returns text language sql as $$
  select pg_temp.sqlstate_of(format(
    'insert into public.transactions (id, userid, accountid, categoryid, description, amount,
                                      transaction_type, transaction_date, counts_despite_anchor,
                                      anchor_answer_set_at)
     select %L, %L, %L, c.id, %L, %s, %L, %L, %L, %L
       from public.categories c
      where c.userid = %L and c.category_name = %L',
    p_id, 'a7c4a7c4-a7c4-4a7c-8a7c-a7c4a7c4a7c4', 'a7c4a7c4-0000-4000-8000-000000000001',
    p_what, p_amount, 'Expense', p_date, p_counts, p_set_at,
    'a7c4a7c4-a7c4-4a7c-8a7c-a7c4a7c4a7c4', 'Groceries'))
$$;

create function pg_temp.balance() returns text language sql as $$
  select balance::text from public.v_account_balances
   where account_id = 'a7c4a7c4-0000-4000-8000-000000000001'
$$;

select pg_temp.rec('4 answers', 'pre-anchor insert with no answer: refused',
  'SRA01', pg_temp.insert_c('a7c4a7c4-0000-4000-8000-0000000000c0', 'c0', 7, date '2026-10-09', null, null));
select pg_temp.rec('4 answers', 'pre-anchor insert answered against an older balance: refused',
  'SRA02', pg_temp.insert_c('a7c4a7c4-0000-4000-8000-0000000000c0', 'c0', 7, date '2026-10-09',
                            true, timestamptz '2026-10-10 17:00Z'));
select pg_temp.rec('4 answers', 'an answer that names no anchor: refused',
  'SRA02',pg_temp.insert_c('a7c4a7c4-0000-4000-8000-0000000000c0', 'c0', 7, date '2026-10-09', true, null));
select pg_temp.rec('4 answers', 'nothing refused moved the balance', '910.00', pg_temp.balance());

-- "No, add it to my balance": a $100 charge that was pending when the balance was read.
select pg_temp.rec('4 answers', '"No" insert: accepted',
  'null', coalesce(pg_temp.insert_c('a7c4a7c4-0000-4000-8000-0000000000c1', 'c1 pending', 100,
                                    date '2026-10-09', true, timestamptz '2026-10-10 21:00Z'), 'null'));
select pg_temp.rec('4 answers', '"No": the balance moves by exactly its amount', '810.00', pg_temp.balance());

-- "Yes, it's already counted": a $5 purchase back-filled for the record.
select pg_temp.rec('4 answers', '"Yes" insert: accepted',
  'null', coalesce(pg_temp.insert_c('a7c4a7c4-0000-4000-8000-0000000000c2', 'c2 history', 5,
                                    date '2026-10-01', false, timestamptz '2026-10-10 21:00Z'), 'null'));
select pg_temp.rec('4 answers', '"Yes": the balance doesn''t move', '810.00', pg_temp.balance());

select pg_temp.rec('4 answers', 'the stored answers read back, and counts_toward_balance agrees',
  'c1 pending:true:true,c2 history:false:false',
  (select string_agg(t.description || ':' || t.counts_despite_anchor || ':' || public.counts_toward_balance(t),
                     ',' order by t.description)
     from public.transactions t
    where t.id in ('a7c4a7c4-0000-4000-8000-0000000000c1', 'a7c4a7c4-0000-4000-8000-0000000000c2')));

-- Editing something the rule doesn't read leaves the answer standing.
update public.transactions set description = 'c1 pending (renamed)'
 where id = 'a7c4a7c4-0000-4000-8000-0000000000c1';
select pg_temp.rec('4 answers', 'renaming a "No" row: still counted, once', '810.00', pg_temp.balance());

-- An answer on a row the date rule already counts is cleared, not kept.
select pg_temp.rec('4 answers', 'after-anchor insert carrying an answer: accepted',
  'null', coalesce(pg_temp.insert_c('a7c4a7c4-0000-4000-8000-0000000000c3', 'c3 after', 1,
                                    date '2026-10-20', true, timestamptz '2026-10-10 21:00Z'), 'null'));
select pg_temp.rec('4 answers', 'after the anchor: no answer stored, counted once',
  'null 809.00', (select coalesce(t.counts_despite_anchor::text, 'null') || ' ' || pg_temp.balance()
                    from public.transactions t where t.id = 'a7c4a7c4-0000-4000-8000-0000000000c3'));

-- A new balance supersedes the answers given against the old one.
select pg_temp.unbecome();
alter table public.accounts disable trigger trg_accounts_anchor_1_lock;
alter table public.accounts disable trigger trg_accounts_anchor_2_stamp;
update public.accounts set opening_set_at = timestamptz '2026-10-15 09:00Z', opening_balance = 700
 where id = 'a7c4a7c4-0000-4000-8000-000000000001';
alter table public.accounts enable trigger trg_accounts_anchor_1_lock;
alter table public.accounts enable trigger trg_accounts_anchor_2_stamp;
select pg_temp.become('a7c4a7c4-a7c4-4a7c-8a7c-a7c4a7c4a7c4');

-- 700 - 40 (b3) - 1 (c3). c1 answered the 21:00Z anchor, so it's out.
select pg_temp.rec('4 answers', 'new balance: the earlier "No" no longer counts', '659.00', pg_temp.balance());
select pg_temp.rec('4 answers', 'moving that row''s date with its old answer: refused as stale',
  'SRA02', pg_temp.sqlstate_of($q$update public.transactions set transaction_date = date '2026-10-08'
                                  where id = 'a7c4a7c4-0000-4000-8000-0000000000c1'$q$));

select pg_temp.unbecome();


-- The report. Must be the last statement that returns rows.
select section, check_ as check, expected, actual, pass
  from anchor_results
 order by seq;

rollback;
