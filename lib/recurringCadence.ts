// Pure cadence math, moved out of lib/db/recurring.ts so the safe-to-spend
// projection (lib/safeToSpendProjection.ts) can step a schedule forward
// with exactly the same rules generateDueOccurrences uses, and be unit
// tested without a database. No "server-only" -- nothing here touches one.
import { addDaysISO } from "@/lib/date";

// ---------------------------------------------------------------------------
// Cadence math
//
// frequency is validated by rectx_frequency_check --
// Daily/Weekly/Biweekly/Monthly/Quarterly/Yearly (see CLAUDE.md "Recurring
// transactions"). Day-of-month/weekday isn't stored anywhere: the schedule is
// entirely "one cadence step from next_run_date", so this is the one place
// that owns the calendar edge cases. Both generateDueOccurrences and any
// future "preview the next occurrence" UI should go through this rather than
// re-deriving it.
// ---------------------------------------------------------------------------

// Adds whole months to an ISO date, landing on anchorDay -- clamped to the
// target month's last day when anchorDay doesn't exist there (anchorDay 31,
// target month Feb -> the 28th/29th, not rolled into March).
//
// anchorDay is deliberately NOT derived from dateISO's own day. Doing that
// would drift the schedule permanently downward the first time a short
// month clamps it: Jan 31 -> Feb 28 (correct), then Feb 28 + 1 month -> Mar
// 28 forever, never back to the 31st a 31-day month actually has. Passing a
// fixed anchorDay (the caller reads it from start_date, which the generator
// never advances) means a July 31 occurrence, three months after a Feb
// clamp, is still the 31st -- and the same guards a Yearly Feb 29 schedule
// from getting stuck on the 28th once it crosses a non-leap year.
function addMonthsClampedISO(dateISO: string, months: number, anchorDay: number): string {
  const [year, month] = dateISO.split("-").map(Number);
  const total = month - 1 + months;
  const targetYear = year + Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const d = new Date(targetYear, targetMonth, Math.min(anchorDay, lastDayOfTargetMonth));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dayOfMonth(dateISO: string): number {
  return Number(dateISO.split("-")[2]);
}

// intervalCount is the N in "every N weeks" -- meaningful for Weekly only.
// anchorDateISO is the schedule's stable reference point for Monthly/
// Quarterly/Yearly (see addMonthsClampedISO) -- callers pass
// template.start_date, never the cursor being advanced. Weekly/Biweekly
// don't need it: +7*N days never drifts off the original weekday the way
// month-length clamping drifts off a day-of-month, so cursor arithmetic
// alone is exact.
//
// lib/recurringSchedule.ts's formatSchedule describes this same cadence in
// words -- keep the two in sync by hand if a case here ever changes.
//
// Daily/Biweekly/Quarterly are still handled here for any row already
// carrying one of those values -- rectx_frequency_check still allows them --
// but the schedule picker no longer writes them: "every N weeks" (Weekly +
// interval_count) folds Biweekly's job in, and Daily/Quarterly turned out to
// be exotic enough nobody used them.
export function nextOccurrenceISO(
  dateISO: string,
  frequency: string,
  intervalCount: number,
  anchorDateISO: string,
): string {
  switch (frequency) {
    case "Daily":
      return addDaysISO(dateISO, 1);
    case "Weekly":
      return addDaysISO(dateISO, 7 * intervalCount);
    case "Biweekly":
      return addDaysISO(dateISO, 14);
    case "Monthly":
      return addMonthsClampedISO(dateISO, 1, dayOfMonth(anchorDateISO));
    case "Quarterly":
      return addMonthsClampedISO(dateISO, 3, dayOfMonth(anchorDateISO));
    case "Yearly":
      return addMonthsClampedISO(dateISO, 12, dayOfMonth(anchorDateISO));
    default:
      // rectx_frequency_check should make this unreachable -- fail loudly
      // rather than silently stalling a schedule on a value the DB let through.
      throw new Error(`Unknown recurring frequency: ${frequency}`);
  }
}

type CadenceFields = {
  next_run_date: string;
  frequency: string;
  interval_count: number;
};

// Whether saving the edit form should move start_date (the anchor
// nextOccurrenceISO reads its day-of-month from) to the posted
// next_run_date. next_run_date is often a CLAMPED date -- a 31st schedule
// sits on Feb 28 or Apr 30 -- and the form posts it back on every save, so
// re-anchoring unconditionally turned "edit the amount in February" into
// "runs on the 28th forever". Re-pin only when the user moved the date or
// changed the cadence, or when there's no anchor at all (legacy rows).
export function shouldReanchor(
  stored: CadenceFields & { start_date: string | null },
  edited: CadenceFields,
): boolean {
  return (
    stored.start_date === null ||
    edited.next_run_date !== stored.next_run_date ||
    edited.frequency !== stored.frequency ||
    edited.interval_count !== stored.interval_count
  );
}
