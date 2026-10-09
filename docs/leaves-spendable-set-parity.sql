-- =====================================================================
-- "Leaves the set" parity test: SQL vs TypeScript
--
-- Run it through the runner, never directly:
--
--   npm run test:parity
--
-- scripts/leaves-spendable-set-parity.ts evaluates the TypeScript
-- classifier (isSafeToSpendCommitment, lib/safeToSpend.ts) over every
-- account type in ACCOUNT_TYPES (lib/accountOptions.ts), pastes the
-- result into the __TS_CLASSIFIER__ marker below, and runs this file
-- against the linked project. Run directly, the marker is not valid JSON
-- and the file errors at once rather than passing on nothing.
--
-- Why it exists: there are two implementations of one rule.
-- leaves_spendable_set() (migration 45) is the SQL one, used by
-- suggested_safe_to_spend_cushion(). isSafeToSpendCommitment is the TS
-- one, used by Spendable Cash and the projection. This test is what makes
-- that safe (docs/phase-7-findings.md, "'Leaves the set' classifier").
--
-- Account types come from accounts_account_type_check -- the database's
-- definition -- never from a list in this file. Adding a type to the
-- constraint creates new cases here automatically; the test then fails
-- until ACCOUNT_TYPES and both classifiers agree on it.
--
-- Sections
--   1  Account types  the constraint's set equals ACCOUNT_TYPES, and
--                     SPENDABLE_ACCOUNT_TYPES is inside it
--   2  Function       leaves_spendable_set(from, to) equals the TS answer
--                     for every (from, to) pair and every plain Expense
--   3  Cushion rows   a real transfer (both legs) for every pair, and a
--                     plain Expense for every source: the cushion counts
--                     the Expense leg exactly once when TS says the money
--                     leaves, and nothing otherwise. The SQL finds the
--                     destination through transfer_group_id; TS reads
--                     to_account_type. This is where those two meet.
--
-- Self-cleaning, like docs/rls-isolation-test.sql: one transaction ending
-- in ROLLBACK, one throwaway user in auth.users. Cleanup check (must be 0):
--   select count(*) from auth.users where email = 'parity-test@example.invalid';
-- =====================================================================

begin;

create temp table parity_results (
  seq      serial primary key,
  section  text not null,
  object   text not null,
  check_   text not null,
  expected text not null,
  actual   text not null,
  pass     boolean not null
);

create function pg_temp.rec(p_section text, p_object text, p_check text,
                            p_expected text, p_actual text, p_pass boolean)
returns void language sql as $$
  insert into parity_results (section, object, check_, expected, actual, pass)
  values (p_section, p_object, p_check,
          coalesce(p_expected, '(none)'), coalesce(p_actual, '(none)'),
          coalesce(p_pass, false))
$$;

-- What the TS side said. Shape:
--   { "account_types":   [...ACCOUNT_TYPES],
--     "spendable_types": [...SPENDABLE_ACCOUNT_TYPES],
--     "cases": [ { "from": t, "to": t | null, "leaves": bool }, ... ] }
-- "to": null is a plain Expense.
create temp table parity_ts as
select $ts$__TS_CLASSIFIER__$ts$::jsonb as payload;

-- The database's account types, parsed out of the CHECK constraint.
create temp table parity_db_types as
select m[1] as account_type, ord
  from pg_constraint c
 cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''::text', 'g')
       with ordinality as r(m, ord)
 where c.conrelid = 'public.accounts'::regclass
   and c.conname = 'accounts_account_type_check';

-- Every pair the test must cover: each type as source, each type (or no
-- destination, a plain Expense) as destination.
create temp table parity_pairs as
select f.account_type as from_type, t.account_type as to_type
  from parity_db_types f
 cross join (select account_type from parity_db_types
             union all
             select null) t;

-- ---------------------------------------------------------------------
-- 1 -- Account types
-- ---------------------------------------------------------------------

-- Guard against a vacuous run: if the constraint were renamed or turned
-- into an enum, the parse returns nothing and every later section would
-- loop over zero types.
select pg_temp.rec('1 account types', 'accounts_account_type_check', 'types parsed',
  'at least 1', count(*)::text, count(*) > 0)
  from parity_db_types;

select pg_temp.rec('1 account types', coalesce(d.account_type, ts.account_type),
  'in constraint and in ACCOUNT_TYPES',
  'both',
  case when d.account_type is null then 'ACCOUNT_TYPES only'
       when ts.account_type is null then 'constraint only'
       else 'both' end,
  d.account_type is not null and ts.account_type is not null)
  from parity_db_types d
  full join (select jsonb_array_elements_text(payload->'account_types') as account_type
               from parity_ts) ts
    on ts.account_type = d.account_type;

select pg_temp.rec('1 account types', s.account_type,
  'SPENDABLE_ACCOUNT_TYPES member is a real type',
  'true', (d.account_type is not null)::text, d.account_type is not null)
  from (select jsonb_array_elements_text(payload->'spendable_types') as account_type
          from parity_ts) s
  left join parity_db_types d on d.account_type = s.account_type;

-- ---------------------------------------------------------------------
-- 2 -- leaves_spendable_set vs isSafeToSpendCommitment
-- ---------------------------------------------------------------------
select pg_temp.rec('2 function',
  p.from_type || ' -> ' || coalesce(p.to_type, '(Expense)'),
  'leaves_spendable_set',
  ts.leaves::text,
  public.leaves_spendable_set(p.from_type, p.to_type)::text,
  ts.leaves = public.leaves_spendable_set(p.from_type, p.to_type))
  from parity_pairs p
  left join (select c->>'from' as from_type, c->>'to' as to_type, (c->>'leaves')::boolean as leaves
               from parity_ts, jsonb_array_elements(payload->'cases') c) ts
    on ts.from_type = p.from_type and ts.to_type is not distinct from p.to_type
 order by p.from_type, p.to_type nulls first;

-- ---------------------------------------------------------------------
-- 3 -- What the cushion actually counts
--
-- One user, two accounts of every type (so a same-type transfer, e.g.
-- Checking -> Checking, has two distinct accounts). History is anchored
-- 90 days back with an Income row, so span = 90. Each case then adds one
-- transaction set dated yesterday, reads the cushion as the user, and
-- deletes it again. With $9,000 the cushion is exactly 9000/90*7 = $700
-- per leg counted, $0 for none: 1400 would be both legs, and a counted
-- Income leg shows up as 700 where TS expects 0.
-- ---------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'parity-test@example.invalid', '{}'::jsonb,
        jsonb_build_object('first_name', 'Parity'), now(), now());

create temp table parity_accounts as
select d.account_type, n, gen_random_uuid() as id
  from parity_db_types d
 cross join generate_series(1, 2) n;

insert into public.accounts (id, userid, account_name, account_type)
select id, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', account_type || ' ' || n, account_type
  from parity_accounts;

do $$
declare
  v_user     constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_amount   constant numeric := 9000;
  v_per_leg  constant numeric := 700;
  v_expense_cat uuid;
  v_income_cat  uuid;
  v_case     record;
  v_from     uuid;
  v_to       uuid;
  v_group    uuid;
  v_cushion  numeric;
begin
  -- Trigger-owned default categories: any active one of each type.
  select id into v_expense_cat from public.categories
   where userid = v_user and category_type = 'Expense' and is_active
   order by category_name limit 1;
  select id into v_income_cat from public.categories
   where userid = v_user and category_type = 'Income' and is_active
   order by category_name limit 1;

  -- History anchor: Income never counts toward the cushion.
  insert into public.transactions (userid, accountid, categoryid, transaction_date,
                                   description, amount, transaction_type)
  select v_user, a.id, v_income_cat, current_date - 90, 'parity anchor', 1, 'Income'
    from parity_accounts a
   order by a.account_type, a.n
   limit 1;

  for v_case in
    select p.from_type, p.to_type, ts.leaves
      from parity_pairs p
      left join (select c->>'from' as from_type, c->>'to' as to_type,
                        (c->>'leaves')::boolean as leaves
                   from parity_ts, jsonb_array_elements(payload->'cases') c) ts
        on ts.from_type = p.from_type and ts.to_type is not distinct from p.to_type
     order by p.from_type, p.to_type nulls first
  loop
    select id into v_from from parity_accounts where account_type = v_case.from_type and n = 1;

    if v_case.to_type is null then
      v_group := null;
      insert into public.transactions (userid, accountid, categoryid, transaction_date,
                                       description, amount, transaction_type)
      values (v_user, v_from, v_expense_cat, current_date - 1, 'parity expense',
              v_amount, 'Expense');
    else
      select id into v_to from parity_accounts where account_type = v_case.to_type and n = 2;
      v_group := gen_random_uuid();
      -- Both legs, as createTransfer() writes them: Expense on the source,
      -- Income on the destination, no category, one shared group.
      insert into public.transactions (userid, accountid, transaction_date, description,
                                       amount, transaction_type, transfer_group_id)
      values (v_user, v_from, current_date - 1, 'parity transfer out', v_amount, 'Expense', v_group),
             (v_user, v_to,   current_date - 1, 'parity transfer in',  v_amount, 'Income',  v_group);
    end if;

    -- Read the cushion exactly as PostgREST would for this user.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_cushion := public.suggested_safe_to_spend_cushion();
    execute 'set local role none';
    perform set_config('request.jwt.claims', '', true);

    perform pg_temp.rec('3 cushion rows',
      v_case.from_type || ' -> ' || coalesce(v_case.to_type, '(Expense)'),
      'cushion counts',
      case when v_case.leaves then v_per_leg::text when not v_case.leaves then '0' end,
      v_cushion::text,
      -- A pair TS has no answer for (leaves is null) fails, never passes.
      v_case.leaves is not null
        and v_cushion = case when v_case.leaves then v_per_leg else 0 end);

    delete from public.transactions
     where userid = v_user and description like 'parity %' and description <> 'parity anchor';
  end loop;
end
$$;

-- The report. Must be the last statement that returns rows.
select section, object, check_ as check, expected, actual, pass
  from parity_results
 order by seq;

rollback;
