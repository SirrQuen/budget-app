-- =====================================================================
-- 12 -- settings.theme contract
--
-- The column already exists and already carries a default; what it has
-- never had is a statement of which values are legal. The app now reads
-- it as a three-state enum ('light' | 'dark' | 'system'), so the range
-- belongs in the schema rather than living only in TypeScript, where a
-- direct SQL write or a future client could quietly step outside it.
--
-- 'system' is the default: absent an explicit choice the app defers to
-- the device's prefers-color-scheme.
--
-- NOT VALID deliberately. It enforces the check on every INSERT and
-- UPDATE from here on, but does not scan the existing rows -- so this
-- cannot fail on legacy data mid-deploy. Backfill first, then validate:
--
--   update settings set theme = 'system'
--    where theme is null or theme not in ('light','dark','system');
--
--   alter table settings validate constraint settings_theme_valid;
--
-- Run those two only once you've looked at what's actually in there:
--
--   select theme, count(*) from settings group by theme;
--
-- Note lib/theme.ts coerceTheme() already treats any unrecognised value
-- as 'system' on read, so an un-backfilled row renders correctly today --
-- it just can't be written back until it's corrected.
--
-- The column itself was added to the remote out of band, ahead of this
-- migration -- no earlier migration creates it. The `add column if not
-- exists` below is a no-op against that remote and makes a rebuild from
-- migrations alone (supabase db reset) correct, so the `set default` that
-- follows always has a column to act on.
-- =====================================================================

alter table public.settings
  add column if not exists theme text;

alter table public.settings
  alter column theme set default 'system';

alter table public.settings
  drop constraint if exists settings_theme_valid;

alter table public.settings
  add constraint settings_theme_valid
  check (theme in ('light', 'dark', 'system'))
  not valid;
