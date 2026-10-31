// Plain-language cadence for a recurring schedule -- "Monthly on the 1st",
// "Every 2 weeks on Friday", never a cron expression (CLAUDE.md "Recurring
// transactions"). frequency itself carries no day-of-month or weekday --
// callers pass the schedule's anchor date (recurring.start_date, falling
// back to next_run_date), the same fixed reference point
// lib/db/recurring.ts's nextOccurrenceISO steps from. Deliberately NOT
// next_run_date directly: that's a live cursor that can sit on a clamped
// day (Feb 28 for a 31st-of-the-month bill) while the schedule's actual day
// is still the 31st -- see addMonthsClampedISO's comment for why the two
// can diverge.

import { formatDate, formatDateShort } from "@/lib/format";
import { parseLocalDate, addDaysISO } from "@/lib/date";

// No explicit timeZone -- anchorDateISO is parsed to local midnight via
// parseLocalDate (matching lib/format.ts's date formatters), so formatting
// in the viewer's own zone lands back on the same calendar weekday/day
// regardless of the offset direction.
const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
});

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function dayOfMonth(dateISO: string): number {
  return Number(dateISO.split("-")[2]);
}

// intervalCount is the N in "every N weeks" -- the picker only ever writes
// it alongside frequency "Weekly" (see lib/db/recurring.ts's
// nextOccurrenceISO); Biweekly is a distinct legacy value from before this
// picker existed, still phrased the same way "every 2 weeks" would be.
export function formatSchedule(frequency: string, anchorDateISO: string, intervalCount = 1): string {
  switch (frequency) {
    case "Daily":
      return "Every day";
    case "Weekly":
      return intervalCount <= 1
        ? `Weekly on ${weekdayFormatter.format(parseLocalDate(anchorDateISO))}`
        : `Every ${intervalCount} weeks on ${weekdayFormatter.format(parseLocalDate(anchorDateISO))}`;
    case "Biweekly":
      return `Every 2 weeks on ${weekdayFormatter.format(parseLocalDate(anchorDateISO))}`;
    case "Monthly":
      return `Monthly on the ${ordinal(dayOfMonth(anchorDateISO))}`;
    case "Quarterly":
      return `Every 3 months on the ${ordinal(dayOfMonth(anchorDateISO))}`;
    case "Yearly":
      return `Yearly on ${formatDateShort(anchorDateISO)}`;
    default:
      // rectx_frequency_check should make this unreachable, same guard as
      // nextOccurrenceISO -- fail visibly rather than showing nothing.
      return frequency;
  }
}

/** "Ends after 6 occurrences" / "Ends Dec 1, 2026" / null when it never does. */
export function formatEndCondition(
  occurrenceLimit: number | null,
  endDateISO: string | null,
): string | null {
  if (occurrenceLimit !== null) {
    return `Ends after ${occurrenceLimit} occurrence${occurrenceLimit === 1 ? "" : "s"}`;
  }
  if (endDateISO !== null) {
    return `Ends ${formatDate(endDateISO)}`;
  }
  return null;
}

/** "the 12th" -- statement_day standing alone, same ordinal formatting as a cadence's day-of-month. */
export function formatStatementDay(statementDay: number): string {
  return `the ${ordinal(statementDay)}`;
}

function lastDayOfMonth(year: number, month1based: number): number {
  return new Date(year, month1based, 0).getDate();
}

// The due day a cursor stands for: its own day, unless it sits on its
// month's last day with the anchor's day later -- then addMonthsClampedISO
// clamped it, and the anchor's day is the schedule's. Holds for every
// frequency: a weekly cursor that isn't clamped keeps its own day.
function rawDueDay(cursorISO: string, anchorDateISO: string): number {
  const [year, month, day] = cursorISO.split("-").map(Number);
  const anchorDay = dayOfMonth(anchorDateISO);
  return day === lastDayOfMonth(year, month) && anchorDay > day ? anchorDay : day;
}

// The card's statement date for the cycle that ends in dueDateISO
// (next_run_date) -- a variable schedule only stores the day-of-month a
// statement posts on, not a full date, since that day is stable cycle to
// cycle the same way a cadence's anchor day is (see addMonthsClampedISO in
// lib/db/recurring.ts). A statement posts BEFORE its due date, so this
// walks back from dueDateISO: same calendar month if statementDay falls on
// or before the due day, otherwise the month before -- exactly the
// "closest prior occurrence of this day-of-month" a card's billing cycle
// actually follows. Clamped the same way a monthly cadence clamps (day 31
// in a 30-day month lands on the 30th) so this never produces an invalid
// date.
//
// The comparison uses RAW days, never clamped ones. Comparing clamped days
// collapsed a cross-month cycle onto the due date whenever a short month
// clamped the statement day down to the due day: statement 31 / due 30 in
// every 30-day month, statement 31 / due 28 in February. So the due day is
// the schedule's own (rawDueDay), which needs anchorDateISO -- the cursor
// alone has lost it once clamped (Feb 28 for a 30th).
export function statementDateForCycle(
  dueDateISO: string,
  statementDay: number,
  anchorDateISO: string,
): string {
  const [year, month] = dueDateISO.split("-").map(Number);
  const dueDay = rawDueDay(dueDateISO, anchorDateISO);

  const sameMonthDay = Math.min(statementDay, lastDayOfMonth(year, month));
  if (statementDay <= dueDay) {
    return `${year}-${String(month).padStart(2, "0")}-${String(sameMonthDay).padStart(2, "0")}`;
  }

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonthDay = Math.min(statementDay, lastDayOfMonth(prevYear, prevMonth));
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(prevMonthDay).padStart(2, "0")}`;
}

// The statement day refused on a variable card payment: the due date's own
// day, which makes the "enter the amount" window the due date alone.
// Raw day numbers, deliberately -- short gaps are allowed, and so is the
// month-end case that only collides in February (29 and 30 both clamp to
// the 28th). A statement day later than the due day is the usual
// cross-month card cycle. Checked by parseRecurringFields
// (lib/actions/recurring.ts), never a CHECK -- the cursor advances onto
// clamped days, so a constraint on next_run_date would reject a
// confirmation rather than a bad schedule.
export function statementDayIsDueDay(statementDay: number, dueDay: number): boolean {
  return statementDay === dueDay;
}

// A card payment's cycle, named so the two dates can't be swapped:
// cursorDate (next_run_date) is the internal cursor the statement walks
// back from and never reaches the user; dueDate (next_due_date, after
// business-day timing) is what's displayed and what the forecast counts.
export type StatementCycle = {
  cursorDate: string;
  dueDate: string;
  statementDay: number;
  /** start_date ?? next_run_date -- the schedule's own due day. */
  anchorDate: string;
};

export function statementDateOf(cycle: StatementCycle): string {
  return statementDateForCycle(cycle.cursorDate, cycle.statementDay, cycle.anchorDate);
}

// Whether today falls inside the "enter the statement amount" window for a
// variable card payment -- from the statement date (inclusive) through the
// adjusted due date (inclusive): once the money has moved, an amount is
// moot. A statement posting after an early-shifted due date leaves no
// window that cycle, for the same reason. That only revises the
// expectation (next_amount); it never writes a transaction. See CLAUDE.md
// "Prompt timing".
export function isAwaitingStatementAmount(todayISO: string, cycle: StatementCycle): boolean {
  return statementDateOf(cycle) <= todayISO && todayISO <= cycle.dueDate;
}

// date_tolerance_days' readers, every one deliberate (CLAUDE.md "Prompt
// timing" and "Uncertainty always pushes the forecast down"):
//
//   - confirmationOpensOn: the confirmation queue opens on the EARLY edge
//     (anchor - tolerance), for every type, so something that lands early
//     can be confirmed the day it lands. For a fixed-date schedule
//     (tolerance 0) that is the expected date itself.
//   - paydayWindowEnd: the projection counts income on the LATE edge
//     (anchor + tolerance), so it is never assumed to arrive early.
//   - expenseCommitmentDate: the projection counts an outflow on the
//     EARLY edge (below).
//
// Never swap these -- paydayWindowEnd(anchor, N) must never land before
// confirmationOpensOn(anchor, N) for the same inputs. Pinned by
// lib/recurringSchedule.test.ts.
export function confirmationOpensOn(anchorISO: string, toleranceDays: number): string {
  return addDaysISO(anchorISO, -toleranceDays);
}

export function paydayWindowEnd(anchorISO: string, toleranceDays: number): string {
  return addDaysISO(anchorISO, toleranceDays);
}

// Phase 6.76 -- the EXPENSE mirror of confirmationOpensOn/
// paydayWindowEnd, and deliberately the OPPOSITE edge from paydayWindowEnd
// for a reason that looks like a bug if it isn't spelled out: a variable-
// date Income schedule's paycheck can only land EARLY (payroll doesn't
// pay late), so getSafeToSpend widens its window to the LATE edge (anchor +
// tolerance) so a pending-but-not-yet-early paycheck isn't dropped. A
// variable-date EXPENSE schedule is the mirror image -- a bill can only
// post EARLY (an autopay or a subscription charges ahead of its due date;
// it doesn't arrive "late", it just becomes overdue) -- so safe-to-spend
// must start treating it as a commitment from the EARLY edge (anchor -
// tolerance), or a bill that's about to charge early would still read as
// "not due yet" and safe-to-spend would overstate what's actually
// available. Same formula as confirmationOpensOn, different caller,
// different reason -- do not fold the two together or a future edit to one
// will silently change the other's meaning. Pinned by
// lib/recurringSchedule.test.ts alongside paydayWindowEnd.
export function expenseCommitmentDate(anchorISO: string, toleranceDays: number): string {
  return addDaysISO(anchorISO, -toleranceDays);
}
