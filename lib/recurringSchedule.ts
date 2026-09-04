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

import { formatDate } from "@/lib/format";

const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  // UTC, matching lib/format.ts's date formatters -- a plain "YYYY-MM-DD"
  // has no time component, and pinning both sides to UTC keeps the
  // displayed weekday/day matching the stored calendar date regardless of
  // the viewer's timezone offset.
  timeZone: "UTC",
});

const monthDayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
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
        ? `Weekly on ${weekdayFormatter.format(new Date(anchorDateISO))}`
        : `Every ${intervalCount} weeks on ${weekdayFormatter.format(new Date(anchorDateISO))}`;
    case "Biweekly":
      return `Every 2 weeks on ${weekdayFormatter.format(new Date(anchorDateISO))}`;
    case "Monthly":
      return `Monthly on the ${ordinal(dayOfMonth(anchorDateISO))}`;
    case "Quarterly":
      return `Every 3 months on the ${ordinal(dayOfMonth(anchorDateISO))}`;
    case "Yearly":
      return `Yearly on ${monthDayFormatter.format(new Date(anchorDateISO))}`;
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
