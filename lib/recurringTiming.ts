// The recurring form's plain-language timing control, mapped onto the
// stored columns. Pure, so the mapping can be tested
// (lib/recurringTiming.test.ts): every choice lands on one of
// NON_BUSINESS_DAY_RULES, and every rule is reachable from the form.
import type { NonBusinessDayRule } from "@/lib/businessDays";

// RecurringForm's TIMING_MODE_OPTIONS/NEAREST_DIRECTION_OPTIONS. Absent
// entirely when the "Adjust timing" panel is collapsed (its fields aren't
// rendered, so they aren't submitted); "exact" means exactly that, same
// as an explicit choice of it.
export const TIMING_MODES = ["exact", "nearest", "after"] as const;
export const NEAREST_DIRECTIONS = ["earlier", "later"] as const;

export type TimingFields = { business_day_offset: number; non_business_day_rule: NonBusinessDayRule };

export function parseTiming(
  mode: string,
  direction: string,
  countInput: string,
): TimingFields | { error: string } {
  if (!TIMING_MODES.includes(mode as (typeof TIMING_MODES)[number])) {
    return { error: "Choose a valid timing option." };
  }
  // "exact" (the collapsed-panel default) maps to offset 0 / rule 'none' --
  // identical to what every row already meant before this control existed.
  if (mode === "after") {
    const business_day_offset = Math.trunc(Number(countInput.trim()));
    if (!Number.isFinite(business_day_offset) || business_day_offset < 1 || business_day_offset > 10) {
      return { error: "Enter how many business days, from 1 to 10." };
    }
    return { business_day_offset, non_business_day_rule: "none" };
  }
  if (mode === "nearest") {
    if (!NEAREST_DIRECTIONS.includes(direction as (typeof NEAREST_DIRECTIONS)[number])) {
      return { error: "Choose a valid shift direction." };
    }
    return { business_day_offset: 0, non_business_day_rule: direction === "earlier" ? "before" : "after" };
  }
  return { business_day_offset: 0, non_business_day_rule: "none" };
}
