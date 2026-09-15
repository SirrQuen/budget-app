// Business-day resolution for recurring schedules -- the source of truth
// for turning a schedule's raw cadence date into the date money actually
// moves. Pure and framework-free (no "server-only") so it's directly
// unit-testable (see businessDays.test.ts) and usable from the client for
// RecurringForm's live "Next: ..." preview -- both need the exact same
// answer, so there's exactly one implementation.
//
// Mirrors supabase/migrations/20260914000025_25_bank_holidays.sql's SQL
// functions (is_business_day, add_business_days, resolve_recurring_due_date)
// by design, not by accident: this file is what actually runs on every
// write (lib/db/recurring.ts), the SQL functions exist only so
// v_integrity_issues can independently recompute and flag drift. Keep the
// two in sync by hand if either ever changes -- same convention
// lib/recurringSchedule.ts already follows for its own duplication of
// lib/db/recurring.ts's cadence math.
//
// Every date in and out is a plain "YYYY-MM-DD" local-calendar string,
// same convention as lib/date.ts -- never routed through `new Date(iso)`,
// which parses as UTC midnight and lands a day early in a negative-offset
// zone (see lib/date.ts's parseLocalDate comment, and the Phase 6 bug it
// fixed).
import { addDaysISO } from "@/lib/date";

export type NonBusinessDayRule = "none" | "before" | "after";

function dayOfWeek(dateISO: string): number {
  const [year, month, day] = dateISO.split("-").map(Number);
  // 0 = Sunday .. 6 = Saturday, in the local calendar -- matches
  // parseLocalDate's local-midnight construction (lib/date.ts), never
  // UTC's getUTCDay().
  return new Date(year, month - 1, day).getDay();
}

export function isBusinessDay(dateISO: string, holidays: ReadonlySet<string>): boolean {
  const dow = dayOfWeek(dateISO);
  return dow !== 0 && dow !== 6 && !holidays.has(dateISO);
}

// Counts forward n business days from anchor, anchor itself excluded from
// the count (T+N convention: addBusinessDays(aFriday, 1) lands on the
// following Monday, not on the Friday). n = 0 is the identity.
export function addBusinessDays(
  anchorISO: string,
  n: number,
  holidays: ReadonlySet<string>,
): string {
  if (n < 0) {
    throw new Error(`addBusinessDays: n must be >= 0, got ${n}`);
  }

  let result = anchorISO;
  let remaining = n;
  while (remaining > 0) {
    result = addDaysISO(result, 1);
    if (isBusinessDay(result, holidays)) {
      remaining -= 1;
    }
  }
  return result;
}

// The one function everything else should call. businessDayOffset > 0
// counts that many business days forward from rawDateISO (rule is
// irrelevant -- the result is already a business day). At offset 0,
// nonBusinessDayRule only does anything when rawDateISO itself isn't a
// business day: 'before'/'after' walk to the nearest one in that
// direction, 'none' leaves it untouched.
export function resolveDueDate(
  rawDateISO: string,
  businessDayOffset: number,
  nonBusinessDayRule: NonBusinessDayRule,
  holidays: ReadonlySet<string>,
): string {
  if (businessDayOffset > 0) {
    return addBusinessDays(rawDateISO, businessDayOffset, holidays);
  }

  if (isBusinessDay(rawDateISO, holidays)) {
    return rawDateISO;
  }

  let d = rawDateISO;
  if (nonBusinessDayRule === "before") {
    while (!isBusinessDay(d, holidays)) {
      d = addDaysISO(d, -1);
    }
  } else if (nonBusinessDayRule === "after") {
    while (!isBusinessDay(d, holidays)) {
      d = addDaysISO(d, 1);
    }
  }
  // 'none': d stays rawDateISO, unshifted.

  return d;
}
