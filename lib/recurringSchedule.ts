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
import { parseLocalDate } from "@/lib/date";

// No explicit timeZone -- anchorDateISO is parsed to local midnight via
// parseLocalDate (matching lib/format.ts's date formatters), so formatting
// in the viewer's own zone lands back on the same calendar weekday/day
// regardless of the offset direction.
const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
});

function ordinal(n: number): string {
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
export function statementDateForCycle(dueDateISO: string, statementDay: number): string {
  const [year, month] = dueDateISO.split("-").map(Number);
  const dueDay = dayOfMonth(dueDateISO);

  const sameMonthDay = Math.min(statementDay, lastDayOfMonth(year, month));
  if (sameMonthDay <= dueDay) {
    return `${year}-${String(month).padStart(2, "0")}-${String(sameMonthDay).padStart(2, "0")}`;
  }

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonthDay = Math.min(statementDay, lastDayOfMonth(prevYear, prevMonth));
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(prevMonthDay).padStart(2, "0")}`;
}

// Whether today falls inside the "ask for the amount" window for a
// variable schedule -- from the statement date (inclusive) through the due
// date (inclusive). See CLAUDE.md "Prompt timing".
export function isAwaitingStatementAmount(
  todayISO: string,
  dueDateISO: string,
  statementDay: number,
): boolean {
  const statementDateISO = statementDateForCycle(dueDateISO, statementDay);
  return statementDateISO <= todayISO && todayISO <= dueDateISO;
}
