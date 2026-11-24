-- Migration 81: list_imports() doesn't count "Turn into a transfer" as an edit
--
-- list_imports() (migration 76) counts an imported row as "edited since
-- the import" when updated_at is past created_at. Turning a row into a
-- transfer (make_transfer(), migration 80) updates it -- its category
-- goes -- so "Undo this import" said "1 of them has been edited since the
-- import" about a row nobody edited, beside the sentence that already
-- says it separates that transfer (undo_import_conversions()). Found in
-- the browser check on sorrel-dev, 2026-11-24.
--
-- A row a conversion touched (its source, or the entry it joined) now
-- counts as edited only when updated_at is past the conversion's
-- created_at. make_transfer() writes the row and the conversion in one
-- transaction, so both carry the same now(); a later edit moves
-- updated_at past it. Once the conversion is undone its record is gone,
-- and the row counts as edited again (its category was put back): the
-- database keeps no history to tell a restore from an edit.
--
-- Same signature, same columns, same security invoker: the grants on
-- list_imports() are kept by create or replace.

create or replace function public.list_imports()
returns table (
  import_id       uuid,
  accountid       uuid,
  account_name    text,
  created_at      timestamptz,
  row_count       integer,
  remaining_count integer,
  edited_count    integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.id, i.accountid, a.account_name, i.created_at, i.row_count,
         count(distinct coalesce(t.transfer_group_id, t.id))::integer,
         (count(distinct coalesce(t.transfer_group_id, t.id)) filter (
            where t.updated_at > greatest(
              t.created_at,
              (select max(c.created_at)
                 from public.transfer_conversions c
                where c.source_transactionid = t.id
                   or c.joined_transactionid = t.id))))::integer
    from public.imports i
    join public.accounts a on a.id = i.accountid
    left join public.transactions t on t.import_id = i.id
   group by i.id, a.account_name
   order by i.created_at desc, i.id
$$;

comment on function public.list_imports() is
  $$The caller's imports, newest first: date, account, how many file rows it wrote, how many of those remain, and how many were edited since (updated_at past created_at -- or, for a row a "Turn into a transfer" touched, past that conversion's created_at, so the conversion itself isn't an edit). Counted as occurrences -- a transfer's two legs are one (migration 76). security invoker: RLS scopes it, transfer_conversions included (migrations 68, 81).$$;
