-- =====================================================================
-- "Is this the same bill?" test (migration 66,
-- docs/Views-Search-Import-Layout.md item 4)
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf -f docs/same-bill-test.sql
--
-- It writes, then rolls back, so it isn't --read-only and the CLI asks
-- for confirmation: Matt runs it. To check migration 66 before it's
-- pushed, put its statements right after BEGIN.
--
-- Returns one row per assertion; a run is clean only when every `pass`
-- is true. Self-cleaning, same as docs/rls-isolation-test.sql: one
-- throwaway user, one transaction, ROLLBACK. Cleanup check (must be 0):
--   select count(*) from auth.users where email like 'sb-test-%@example.invalid';
--
-- The match and the forecast's arithmetic are TypeScript, pinned by
-- lib/sameBill.test.ts. What only the database can show:
--
--   1  Before an answer both halves are counted: the entry is in
--      v_future_transactions and the schedule's next occurrence is its date.
--   2  A stale "Yes" (the cursor has moved) writes nothing.
--   3  "Yes": the entry is linked, the schedule steps past the occurrence,
--      and the answer records the step.
--   4  A second "Yes" to the same occurrence finds it answered.
--   5  Deleting the entry after "Yes" while nothing has moved: the preview
--      says it restores, and the trigger puts the occurrence back -- the
--      bill is in the forecast again.
--   6  Deleting it after the schedule HAS moved: the preview says it
--      won't be in the forecast (the confirmation tells the person), and
--      no answered cycle is reopened.
--   7  "Yes" on an entry dated today (not ahead) does nothing.
--   8  "No, keep both" is remembered once; "Change your answer" clears it
--      and never touches a "Yes".
--   9  The table can't be written directly -- only through the functions.
--  10  A transfer: answered through either leg, both legs linked, and
--      deleting the transfer restores.
--  11  delete_own_account() leaves no answer behind.
-- =====================================================================

begin;

create temp table sb_results (
  seq      serial primary key,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);
grant insert, select on sb_results to authenticated;
grant usage on sequence sb_results_seq_seq to authenticated;

create function pg_temp.rec(p_check text, p_expected text, p_actual text) returns void
language sql as $$
  insert into sb_results (check_, expected, actual, pass)
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

insert into auth.users (id, instance_id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'sb-test-d@example.invalid', '{}'::jsonb,
        '{"first_name": "Sb", "last_name": "Test"}'::jsonb, now(), now());

do $$
declare
  u        constant uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  chk      constant uuid := 'dddddddd-0000-4000-8000-000000000001';
  sav      constant uuid := 'dddddddd-0000-4000-8000-000000000002';
  rent_s   constant uuid := 'dddddddd-0000-4000-8000-000000000011';
  xfer_s   constant uuid := 'dddddddd-0000-4000-8000-000000000012';
  tx1      constant uuid := 'dddddddd-0000-4000-8000-000000000021';
  tx2      constant uuid := 'dddddddd-0000-4000-8000-000000000022';
  tx3      constant uuid := 'dddddddd-0000-4000-8000-000000000023';
  tx4      constant uuid := 'dddddddd-0000-4000-8000-000000000024';
  out_leg  constant uuid := 'dddddddd-0000-4000-8000-000000000031';
  in_leg   constant uuid := 'dddddddd-0000-4000-8000-000000000032';
  grp      constant uuid := 'dddddddd-0000-4000-8000-000000000041';
  d0       constant date := current_date + 17;   -- the occurrence both halves are about
  d1       constant date := current_date + 47;   -- the cycle after it
  d2       constant date := current_date + 77;   -- the one after that
  rent_cat uuid;
  res      text;
  state    text;
  r        record;
begin
  select id into rent_cat from public.categories where userid = u and category_name = 'Rent';

  perform pg_temp.become(u);

  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (chk, u, 'SB checking', 'Checking', 5000, current_date - 10),
         (sav, u, 'SB savings',  'Savings',  0,    current_date - 10);

  insert into public.recurring_transactions
    (id, userid, accountid, categoryid, description, amount, frequency,
     next_run_date, start_date, next_due_date)
  values (rent_s, u, chk, rent_cat, 'Rent', 1850, 'Monthly', d0, d0, d0);

  -- The entry the person typed in for the same bill.
  insert into public.transactions (id, userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description)
  values (tx1, u, chk, rent_cat, 1850, 'Expense', d0, 'Rent');

  -- 1 -----------------------------------------------------------------
  perform pg_temp.rec('1 before: the entry is a future row the forecast counts', '1',
    (select count(*)::text from public.v_future_transactions where transaction_id = tx1));
  perform pg_temp.rec('1 before: the schedule''s next occurrence is the same day', d0::text,
    (select next_due_date::text from public.v_upcoming_recurring where recurring_id = rent_s));

  -- 2 -----------------------------------------------------------------
  res := public.confirm_same_bill(tx1, rent_s, d0 - 1, d1, d1);
  perform pg_temp.rec('2 a stale "Yes" (cursor moved)', 'already_answered', res);
  perform pg_temp.rec('2 ... links nothing', '<null>',
    (select coalesce(recurringid::text, '<null>') from public.transactions where id = tx1));

  -- 3 -----------------------------------------------------------------
  res := public.confirm_same_bill(tx1, rent_s, d0, d1, d1);
  perform pg_temp.rec('3 "Yes"', 'answered', res);
  perform pg_temp.rec('3 the entry is linked to the schedule', rent_s::text,
    (select recurringid::text from public.transactions where id = tx1));
  perform pg_temp.rec('3 the schedule stepped past the occurrence', d1::text || ' ' || d1::text,
    (select next_run_date::text || ' ' || next_due_date::text from public.recurring_transactions where id = rent_s));
  perform pg_temp.rec('3 the answer records the step', 'same ' || d0 || ' ' || d0 || ' ' || d1,
    (select answer || ' ' || occurrence_due_date || ' ' || occurrence_run_date || ' ' || advanced_to_run_date
       from public.same_bill_answers where transactionid = tx1));
  perform pg_temp.rec('3 counted once: the entry is still a future row', '1',
    (select count(*)::text from public.v_future_transactions where transaction_id = tx1));

  -- 4 -----------------------------------------------------------------
  res := public.confirm_same_bill(tx1, rent_s, d0, d1, d1);
  perform pg_temp.rec('4 a second "Yes" to the same occurrence', 'already_answered', res);

  -- 5 -----------------------------------------------------------------
  select * into r from public.same_bill_delete_preview(array[tx1]);
  perform pg_temp.rec('5 preview: deleting it restores', 'true Rent ' || d0,
    r.restores::text || ' ' || r.schedule_name || ' ' || r.occurrence_due_date);
  delete from public.transactions where id = tx1;
  perform pg_temp.rec('5 deleted: the occurrence is back on the schedule', d0::text || ' ' || d0::text,
    (select next_run_date::text || ' ' || next_due_date::text from public.recurring_transactions where id = rent_s));
  perform pg_temp.rec('5 ... so the forecast has the bill again', d0::text,
    (select next_due_date::text from public.v_upcoming_recurring where recurring_id = rent_s));
  perform pg_temp.rec('5 ... and the answer went with the entry', '0',
    (select count(*)::text from public.same_bill_answers where recurringid = rent_s));

  -- 6 -----------------------------------------------------------------
  insert into public.transactions (id, userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description)
  values (tx2, u, chk, rent_cat, 1850, 'Expense', d0, 'Rent');
  res := public.confirm_same_bill(tx2, rent_s, d0, d1, d1);
  perform pg_temp.rec('6 "Yes" again, on a new entry', 'answered', res);
  -- The schedule moves on before the delete: a later cycle answered.
  update public.recurring_transactions set next_run_date = d2, next_due_date = d2 where id = rent_s;
  select * into r from public.same_bill_delete_preview(array[tx2]);
  perform pg_temp.rec('6 preview: it won''t restore, and says where the schedule picks up', 'false ' || d2,
    r.restores::text || ' ' || r.resumes_on);
  delete from public.transactions where id = tx2;
  perform pg_temp.rec('6 deleted: no answered cycle is reopened', d2::text,
    (select next_run_date::text from public.recurring_transactions where id = rent_s));
  -- Back to the occurrence for the cases below.
  update public.recurring_transactions set next_run_date = d0, next_due_date = d0 where id = rent_s;

  -- 7 -----------------------------------------------------------------
  insert into public.transactions (id, userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description)
  values (tx3, u, chk, rent_cat, 1850, 'Expense', current_date, 'Rent today');
  res := public.confirm_same_bill(tx3, rent_s, d0, d1, d1);
  perform pg_temp.rec('7 "Yes" on an entry dated today', 'not_ahead', res);
  perform pg_temp.rec('7 ... links nothing and leaves the schedule', '<null> ' || d0,
    (select coalesce(t.recurringid::text, '<null>') || ' ' || r2.next_run_date
       from public.transactions t, public.recurring_transactions r2 where t.id = tx3 and r2.id = rent_s));

  -- 8 -----------------------------------------------------------------
  insert into public.transactions (id, userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description)
  values (tx4, u, chk, rent_cat, 1850, 'Expense', d0, 'Rent, another one');
  perform public.record_different_bill(tx4, rent_s, d0);
  perform public.record_different_bill(tx4, rent_s, d0);
  perform pg_temp.rec('8 "No, keep both" is remembered, once', '1 different ' || d0,
    (select count(*)::text || ' ' || min(answer) || ' ' || min(occurrence_due_date)
       from public.same_bill_answers where transactionid = tx4));
  perform pg_temp.rec('8 ... and changes nothing else', '<null> ' || d0,
    (select coalesce(t.recurringid::text, '<null>') || ' ' || r2.next_run_date
       from public.transactions t, public.recurring_transactions r2 where t.id = tx4 and r2.id = rent_s));
  perform public.clear_different_bill(tx4, rent_s);
  perform pg_temp.rec('8 "Change your answer" clears it', '0',
    (select count(*)::text from public.same_bill_answers where transactionid = tx4));
  res := public.confirm_same_bill(tx4, rent_s, d0, d1, d1);
  perform public.clear_different_bill(tx4, rent_s);
  perform pg_temp.rec('8 ... and never clears a "Yes"', 'same',
    (select answer from public.same_bill_answers where transactionid = tx4));
  perform public.record_different_bill(tx4, rent_s, d0);
  perform pg_temp.rec('8 ... nor is a "Yes" overwritten by a "No"', 'same',
    (select answer from public.same_bill_answers where transactionid = tx4));

  -- 9 -----------------------------------------------------------------
  state := null;
  begin
    insert into public.same_bill_answers (userid, recurringid, transactionid, answer, occurrence_due_date,
                                          occurrence_run_date, advanced_to_run_date)
    values (u, rent_s, tx3, 'same', d0, d0, d1);
  exception when others then state := sqlstate;
  end;
  perform pg_temp.rec('9 a direct INSERT is refused', '42501', state);
  state := null;
  begin
    update public.same_bill_answers set advanced_to_run_date = d2 where transactionid = tx4;
  exception when others then state := sqlstate;
  end;
  perform pg_temp.rec('9 a direct UPDATE is refused', '42501', state);
  state := null;
  begin
    delete from public.same_bill_answers where transactionid = tx4;
  exception when others then state := sqlstate;
  end;
  perform pg_temp.rec('9 a direct DELETE is refused', '42501', state);

  -- 10 ----------------------------------------------------------------
  insert into public.recurring_transactions
    (id, userid, accountid, to_accountid, description, amount, frequency,
     next_run_date, start_date, next_due_date)
  values (xfer_s, u, chk, sav, 'To savings', 300, 'Monthly', d0, d0, d0);
  insert into public.transactions (id, userid, accountid, categoryid, amount, transaction_type,
                                   transaction_date, description, transfer_group_id)
  values (out_leg, u, chk, null, 300, 'Expense', d0, 'To savings', grp),
         (in_leg,  u, sav, null, 300, 'Income',  d0, 'To savings', grp);
  res := public.confirm_same_bill(in_leg, xfer_s, d0, d1, d1);
  perform pg_temp.rec('10 a transfer, answered through its Income leg', 'answered', res);
  perform pg_temp.rec('10 both legs linked', '2',
    (select count(*)::text from public.transactions where transfer_group_id = grp and recurringid = xfer_s));
  perform pg_temp.rec('10 the answer sits on the Expense leg', out_leg::text,
    (select transactionid::text from public.same_bill_answers where recurringid = xfer_s));
  perform pg_temp.rec('10 the preview finds it through either leg', 'true',
    (select restores::text from public.same_bill_delete_preview(array[in_leg])));
  delete from public.transactions where transfer_group_id = grp;
  perform pg_temp.rec('10 deleting the transfer restores the occurrence', d0::text,
    (select next_run_date::text from public.recurring_transactions where id = xfer_s));

  -- 11 ----------------------------------------------------------------
  -- tx4 still carries its "same" answer; add a "No" so both kinds exist.
  perform public.record_different_bill(tx3, rent_s, d0);
  perform pg_temp.unbecome();
  perform pg_temp.rec('11 before: the user has answers of both kinds', '2',
    (select count(distinct answer)::text from public.same_bill_answers where userid = u));
  perform pg_temp.become(u);
  perform public.delete_own_account();
  perform pg_temp.unbecome();
  perform pg_temp.rec('11 delete_own_account() leaves no answer behind', '0',
    (select count(*)::text from public.same_bill_answers where userid = u));
end
$$;

select seq, check_, expected, actual, pass from sb_results order by seq;

rollback;
