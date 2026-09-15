// Shared between the settings Server Action (validation) and the settings
// toggle (rendering) -- no "server-only" import, mirrors lib/theme.ts.

export const SAFE_TO_SPEND_WINDOWS = ["next_payday", "end_of_month", "next_30_days"] as const;
export type SafeToSpendWindowPref = (typeof SAFE_TO_SPEND_WINDOWS)[number];

export function isSafeToSpendWindowPref(value: unknown): value is SafeToSpendWindowPref {
  return (
    typeof value === "string" &&
    (SAFE_TO_SPEND_WINDOWS as readonly string[]).includes(value)
  );
}

// Unlike lib/theme.ts's coerceTheme, this can return null: settings.
// safe_to_spend_window is nullable on purpose (see
// 20260914000026_26_safe_to_spend_window_setting.sql) -- null means "no
// explicit choice yet, use the dynamic default" (next payday when an
// income schedule exists, end of month otherwise -- lib/db/dashboard.ts's
// getSafeToSpend), which is different from any of the three concrete
// values. Anything unrecognised also coerces to null rather than to a
// guessed default, same "never let a bad stored value break a render"
// rule coerceTheme follows.
export function coerceSafeToSpendWindowPref(value: unknown): SafeToSpendWindowPref | null {
  return isSafeToSpendWindowPref(value) ? value : null;
}

export const SAFE_TO_SPEND_WINDOW_LABELS: Record<SafeToSpendWindowPref, string> = {
  next_payday: "Next payday",
  end_of_month: "End of month",
  next_30_days: "Next 30 days",
};
