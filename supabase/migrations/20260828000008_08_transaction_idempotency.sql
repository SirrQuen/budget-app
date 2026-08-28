-- =====================================================================
-- 08: Transaction idempotency key
--
-- Quick-add can be submitted twice for the same intended transaction --
-- a mashed Enter key, or a client retry after a slow/dropped response.
-- The client generates one crypto.randomUUID() per fill of the form and
-- resends the same key on retry; the unique index below turns a second
-- insert carrying that key into a no-op the app layer can detect and
-- resolve to the first row, instead of a second row.
--
-- Nullable and partial: rows created before this migration, and any
-- write path that doesn't supply a key (imports, recurring postings),
-- are unaffected -- only two inserts sharing the same non-null key for
-- the same user collide.
-- =====================================================================

alter table transactions
  add column if not exists idempotency_key uuid;

create unique index if not exists transactions_userid_idempotency_key_key
  on transactions (userid, idempotency_key)
  where idempotency_key is not null;
