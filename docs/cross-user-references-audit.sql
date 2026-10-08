-- =====================================================================
-- Cross-user reference audit
--
--   npx supabase@latest db query --linked -f docs/cross-user-references-audit.sql
--
-- For every foreign key from one user-owned table to another, counts the
-- child rows whose owner differs from the owner of the row they point
-- at. Every count must be 0. Read-only.
--
-- Driven from pg_constraint, so a foreign key added by a later migration
-- is audited without editing this file. FKs to profiles are skipped:
-- those ARE the owner column, not a reference to someone's data.
--
-- Composite FKs (userid, ref) -> parent(userid, id) (migration 44) are
-- audited on their non-userid column. They cannot hold a mismatch by
-- construction; auditing them anyway keeps this file vacuous-proof if one
-- is ever rewritten back to single-column.
--
-- Owner of a row is its userid. goal_contributions had no userid before
-- migration 44 and belonged to its goal's owner; that branch is kept so
-- the audit still runs against a database from before 44.
-- =====================================================================

with fks as (
  select con.conname,
         cr.relname as child,
         ca.attname as col,
         pr.relname as parent,
         pa.attname as pcol
    from pg_constraint con
    join pg_class cr on cr.oid = con.conrelid
    join pg_class pr on pr.oid = con.confrelid
    cross join lateral unnest(con.conkey, con.confkey) as k(ck, pk)
    join pg_attribute ca on ca.attrelid = con.conrelid  and ca.attnum = k.ck
    join pg_attribute pa on pa.attrelid = con.confrelid and pa.attnum = k.pk
   where con.contype = 'f'
     and con.connamespace = 'public'::regnamespace
     and pr.relnamespace  = 'public'::regnamespace
     and pr.relname <> 'profiles'
     and (cardinality(con.conkey) = 1 or ca.attname <> 'userid')
),
owners as (
  select f.*,
         case when exists (select 1 from information_schema.columns
                            where table_schema = 'public' and table_name = f.child and column_name = 'userid')
              then 'c.userid'
              when f.child = 'goal_contributions'
              then '(select g.userid from public.goals g where g.id = c.goalid)'
         end as child_owner,
         case when exists (select 1 from information_schema.columns
                            where table_schema = 'public' and table_name = f.parent and column_name = 'userid')
              then 'p.userid'
              when f.parent = 'goal_contributions'
              then '(select g.userid from public.goals g where g.id = p.goalid)'
         end as parent_owner
    from fks f
),
audited as (
  select o.*,
         format('select c.id from public.%I c join public.%I p on p.%I = c.%I where %s is distinct from %s',
                o.child, o.parent, o.pcol, o.col, o.child_owner, o.parent_owner) as sql
    from owners o
   where o.child_owner is not null and o.parent_owner is not null
)
select a.child || '.' || a.col || ' -> ' || a.parent || '.' || a.pcol as reference,
       a.conname as constraint_name,
       (xpath('/row/n/text()',
          query_to_xml(format('select count(*) as n from (%s) x', a.sql), false, true, '')))[1]::text::bigint
         as mismatched_rows,
       (xpath('/row/ids/text()',
          query_to_xml(format('select string_agg(id::text, '','' order by id) as ids from (%s limit 20) x', a.sql),
                       false, true, '')))[1]::text
         as first_20_child_ids
  from audited a
 order by 1;
