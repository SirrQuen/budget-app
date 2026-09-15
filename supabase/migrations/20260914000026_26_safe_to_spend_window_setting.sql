-- =====================================================================
-- EverNest 26: settings.safe_to_spend_window
--
-- Per-user preference for what the safe-to-spend hero counts down to:
-- 'next_payday' | 'end_of_month' | 'next_30_days'. Nullable, unlike
-- settings.theme's 'system' default (20260829000012_12_theme_contract.sql)
-- -- there the third option genuinely is the stored default. Here the
-- default is data-dependent ("next payday when an income schedule exists,
-- end of month otherwise" -- see the task brief), which can't be expressed
-- as a fixed column default. null means "no explicit choice yet, use the
-- dynamic default"; lib/db/dashboard.ts's getSafeToSpend() treats null the
-- same as an explicit 'next_payday', which already falls back to
-- end-of-month on its own when no income schedule exists -- so the dynamic
-- default falls out of that one rule rather than needing a second code
-- path. Once a user picks anything (including picking 'next_payday'
-- explicitly), it's stored and sticky.
-- =====================================================================

alter table public.settings
  add column if not exists safe_to_spend_window text;

alter table public.settings
  drop constraint if exists settings_safe_to_spend_window_valid;

alter table public.settings
  add constraint settings_safe_to_spend_window_valid
  check (safe_to_spend_window in ('next_payday', 'end_of_month', 'next_30_days'))
  not valid;

alter table public.settings
  validate constraint settings_safe_to_spend_window_valid;
