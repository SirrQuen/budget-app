-- =====================================================================
-- Migration 67: dashboard layout -- reorder and hide sections
--
-- Two nullable columns on settings, both ordered lists of section NAMES
-- (lib/dashboardLayout.ts holds the names):
--
--   dashboard_order   the order the person chose. null = the default.
--   dashboard_hidden  the names they hid. null = nothing hidden.
--
-- Names, not positions, and not validated against a list here: a section
-- shipped later must not break anyone's saved layout, so the app ignores
-- names it doesn't know and appends sections the list lacks. The Safe to
-- Spend hero is in neither list -- it is pinned first and can't be hidden.
-- Hidden is its own column because "not in the order" has to keep meaning
-- "new, show it at the end".
--
-- Written only by the explicit Save in edit mode (never during render).
-- settings already carries RLS scoped to auth.uid() and the table-level
-- grant to authenticated; a column added to it needs neither. No view
-- is created, so no view grant block.
-- =====================================================================

alter table public.settings
  add column if not exists dashboard_order  text[],
  add column if not exists dashboard_hidden text[];

alter table public.settings
  drop constraint if exists settings_dashboard_layout_size;
alter table public.settings
  add constraint settings_dashboard_layout_size check (
    (dashboard_order  is null or cardinality(dashboard_order)  <= 50)
    and (dashboard_hidden is null or cardinality(dashboard_hidden) <= 50)
  );

comment on column public.settings.dashboard_order is
  'Ordered dashboard section names the person chose (lib/dashboardLayout.ts). null = default order. Unknown names are ignored on read; sections not listed are appended.';
comment on column public.settings.dashboard_hidden is
  'Dashboard section names the person hid. null = none. The Safe to Spend hero is never listed: it cannot be hidden.';
