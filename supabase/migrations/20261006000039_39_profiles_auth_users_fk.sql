-- =====================================================================
-- EverNest 39: Capture the profiles -> auth.users FK in a migration
--
-- Production has
--
--   profiles_userid_fkey  FOREIGN KEY (id) REFERENCES auth.users(id)
--                         ON UPDATE CASCADE ON DELETE CASCADE
--
-- but no migration creates it -- it predates migration 01 (made in the
-- dashboard). delete_own_account() ends with `delete from auth.users` and
-- relies on this cascade to remove the profiles row; a database rebuilt
-- from migrations alone would have no FK, and deletion would leave the
-- user's name, username and phone behind in an orphan profiles row.
-- See "Section 1" in docs/phase-7-findings.md.
--
-- Recreated with the identical definition under an accurate name: the
-- column is profiles.id, there is no profiles.userid. On production this
-- is a rename; on a fresh database it creates the FK.
--
-- profiles is small (one row per user) and had 0 orphans on 2026-10-06,
-- so the immediate validation of ADD CONSTRAINT is cheap and will pass.
-- =====================================================================

alter table public.profiles drop constraint if exists profiles_userid_fkey;
alter table public.profiles drop constraint if exists profiles_id_fkey;

alter table public.profiles add constraint profiles_id_fkey
  foreign key (id) references auth.users(id)
  on update cascade on delete cascade;


-- =====================================================================
-- Verify
-- =====================================================================
-- Exactly one row: profiles_id_fkey, CASCADE.
-- select conname,
--        case confdeltype when 'c' then 'CASCADE' when 'r' then 'RESTRICT'
--                         when 'a' then 'NO ACTION' when 'n' then 'SET NULL'
--                         when 'd' then 'SET DEFAULT' end as on_delete,
--        pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid = 'public.profiles'::regclass
--    and confrelid = 'auth.users'::regclass;


-- =====================================================================
-- Rollback -- restore the original name (never drop the FK itself;
-- delete_own_account() depends on it)
-- =====================================================================
-- alter table public.profiles rename constraint profiles_id_fkey to profiles_userid_fkey;
