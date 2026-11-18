// The Upcoming card's Timeline view (docs/Decide-and-Grow.md, I). A second
// way of reading the SAME items the list reads -- buildUpcomingOccurrences,
// i.e. the projection's own occurrences -- never a second query and never a
// second classifier. Transfers inside the spendable set aren't here because
// the projection never counted them. The tightest day is the hero's:
// `trough.date`, the day whyThisNumber() names.

import { addDaysISO } from "@/lib/date";
import { formatCurrency, formatDateShort, formatWeekday } from "@/lib/format";
import { UPCOMING_DEFAULT_DAYS, type UpcomingOccurrence, type UpcomingOccurrences } from "@/lib/upcomingOccurrences";

export type TimelineDay = {
  date: string;
  /** Bills, then income -- the order the list uses within a day. */
  items: UpcomingOccurrence[];
  /** The hero's tightest day, only when it falls inside the window. */
  tightest: boolean;
};

/**
 * Today through today + 13, one entry per day. Items are exactly the list's
 * rows for that window, minus the "missed paycheck" notes (they describe a
 * date already past, so they have no day here).
 */
export function buildTimelineDays(data: UpcomingOccurrences, today: string, tightestDate: string): TimelineDay[] {
  return Array.from({ length: UPCOMING_DEFAULT_DAYS }, (_, i) => {
    const date = addDaysISO(today, i);
    return {
      date,
      items: data.items.filter((item) => item.status !== "missed" && item.date === date),
      tightest: tightestDate === date,
    };
  });
}

/** "Friday, Nov 20: Visa payment, $1,320" -- what a screen reader hears for a day. */
export function dayLabel(day: TimelineDay): string {
  const when = `${formatWeekday(day.date)}, ${formatDateShort(day.date)}`;
  const what =
    day.items.length === 0
      ? "nothing due"
      : day.items
          .map((i) => `${i.name}, ${formatCurrency(i.amount)}${i.direction === "income" ? " coming in" : ""}`)
          .join("; ");
  return `${when}: ${what}${day.tightest ? ". Your tightest day" : ""}`;
}

export const TIMELINE_VIEW_KEY = "upcoming-view";
