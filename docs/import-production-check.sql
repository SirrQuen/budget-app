-- =====================================================================
-- Migration 68 (CSV import): is it on this database, and is it right?
--
--   npx supabase db query --remote=ybdwqyihvbokowocvlgq --read-only -f docs/import-production-check.sql
--
-- READ-ONLY: one SELECT over the catalogs, plus two aggregate counts. It
-- reads no row content -- no descriptions, amounts, dates or user ids. Safe
-- on production. Works on dev too (--remote=tztbebdzlezlhvsbylsf).
--
-- Read the `Target:` line first and say the project name and ref. A push
-- to production prints "(not the linked project)".
--
-- Returns one row per check; clean only when every `pass` is true. The last
-- two rows are counts, not checks: on production right after deploy,
-- imports should be 0 until someone imports.
-- =====================================================================

with
fns(fn, anon_expected, authed_expected) as (
  values
    ('public.import_preview(uuid,date[])',                        false, true),
    ('public.import_transactions(uuid,jsonb,boolean,uuid)',       false, true),
    ('public.undo_import(uuid)',                                  false, true),
    ('public.list_imports()',                                     false, true),
    ('public.same_bill_answer(uuid,uuid,date,date,date,boolean)', false, false),
    ('public.confirm_same_bill(uuid,uuid,date,date,date)',        false, true)
),
checks as (
  -- The table, with row level security on.
  select 1 as o, 'imports table exists, RLS on' as check_, 'true' as expected,
         coalesce((select c.relrowsecurity::text from pg_class c
                    where c.oid = to_regclass('public.imports')), 'missing') as actual

  union all
  -- No filename or content column: exactly these six.
  select 2, 'imports columns (no filename, no content)',
         'accountid,created_at,id,idempotency_key,row_count,userid',
         coalesce((select string_agg(column_name, ',' order by column_name)
                     from information_schema.columns
                    where table_schema = 'public' and table_name = 'imports'), 'missing')

  union all
  -- Composite FKs, both ON DELETE RESTRICT ('r'), never CASCADE ('c').
  select 3, 'imports_accountid_fkey: (userid, accountid), RESTRICT',
         'FOREIGN KEY (userid, accountid) REFERENCES accounts(userid, id) ON DELETE RESTRICT',
         coalesce((select pg_get_constraintdef(oid) from pg_constraint
                    where conname = 'imports_accountid_fkey' and conrelid = to_regclass('public.imports')), 'missing')
  union all
  select 4, 'transactions_import_fkey: (userid, import_id), RESTRICT',
         'FOREIGN KEY (userid, import_id) REFERENCES imports(userid, id) ON DELETE RESTRICT',
         coalesce((select pg_get_constraintdef(oid) from pg_constraint
                    where conname = 'transactions_import_fkey' and conrelid = to_regclass('public.transactions')), 'missing')

  union all
  -- Policies: select-own only; nothing that writes.
  select 5, 'imports policies', 'imports_select_own SELECT',
         coalesce((select string_agg(polname || ' ' || case polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                                                      when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end,
                                     ', ' order by polname)
                     from pg_policy where polrelid = to_regclass('public.imports')), 'missing')

  union all
  -- Table grants (migration 66's block): authenticated reads; anon and
  -- PUBLIC nothing; service_role no data privileges.
  select 6, 'imports grants: authenticated', 'SELECT',
         coalesce((select string_agg(a.privilege_type, ',' order by a.privilege_type)
                     from pg_class c cross join lateral aclexplode(c.relacl) a
                     join pg_roles r on r.oid = a.grantee
                    where c.oid = to_regclass('public.imports') and r.rolname = 'authenticated'), 'none')
  union all
  select 7, 'imports grants: anon and PUBLIC', 'none',
         coalesce((select string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || a.privilege_type, ',')
                     from pg_class c cross join lateral aclexplode(c.relacl) a
                     left join pg_roles r on r.oid = a.grantee
                    where c.oid = to_regclass('public.imports')
                      and (a.grantee = 0 or r.rolname = 'anon')), 'none')
  union all
  select 8, 'imports grants: service_role (no data access)', 'MAINTAIN,REFERENCES,TRIGGER,TRUNCATE',
         coalesce((select string_agg(a.privilege_type, ',' order by a.privilege_type)
                     from pg_class c cross join lateral aclexplode(c.relacl) a
                     join pg_roles r on r.oid = a.grantee
                    where c.oid = to_regclass('public.imports') and r.rolname = 'service_role'), 'none')

  union all
  select 9, 'transactions.import_id exists (uuid, nullable)', 'uuid YES',
         coalesce((select data_type || ' ' || is_nullable from information_schema.columns
                    where table_schema = 'public' and table_name = 'transactions' and column_name = 'import_id'), 'missing')

  union all
  -- Each function: who can execute it. same_bill_answer is internal.
  select 10, 'execute: ' || f.fn || ' (anon / authenticated)',
         f.anon_expected::text || ' / ' || f.authed_expected::text,
         coalesce(has_function_privilege('anon', to_regprocedure(f.fn), 'execute')::text || ' / '
                  || has_function_privilege('authenticated', to_regprocedure(f.fn), 'execute')::text, 'missing')
    from fns f

  union all
  -- The two replaced functions carry the new behaviour.
  select 11, 'delete_own_account() deletes imports before accounts', 'true',
         coalesce((select (position('delete from public.imports' in lower(pg_get_functiondef(p.oid))) > 0
                           and position('delete from public.imports' in lower(pg_get_functiondef(p.oid)))
                               < position('delete from public.accounts' in lower(pg_get_functiondef(p.oid))))::text
                     from pg_proc p where p.oid = to_regprocedure('public.delete_own_account()')), 'missing')
  union all
  select 12, 'confirm_same_bill() calls same_bill_answer()', 'true',
         coalesce((select (position('same_bill_answer' in pg_get_functiondef(p.oid)) > 0)::text
                     from pg_proc p where p.oid = to_regprocedure('public.confirm_same_bill(uuid,uuid,date,date,date)')), 'missing')

  union all
  -- The import trigger-free guarantee the app relies on: the anchor trigger
  -- is still there (import answers it per row; it must still refuse a row
  -- with no answer).
  select 13, 'trg_transactions_anchor_answer still on transactions', 'true',
         exists (select 1 from pg_trigger
                  where tgname = 'trg_transactions_anchor_answer'
                    and tgrelid = to_regclass('public.transactions') and not tgisinternal)::text

  union all
  -- Counts, not checks: aggregates only, no row content. Not judged (o >= 14).
  select 14, 'COUNT imports (0 until someone imports)', '',
         coalesce((select count(*)::text from public.imports), 'missing')
  union all
  select 15, 'COUNT transactions with an import_id', '',
         coalesce((select count(*)::text from public.transactions where import_id is not null), 'missing')
)
select check_, expected, actual, (expected = actual or o >= 14) as pass
  from checks
 order by o, check_;
