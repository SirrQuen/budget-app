import { daysBetweenInclusive, parseLocalDate, todayInZone } from "@/lib/date";
import { formatDateShort } from "@/lib/format";

const weekdayLong = new Intl.DateTimeFormat("en-US", { weekday: "long" });

// "earlier today" / "yesterday" / "Tuesday" / "Oct 7" -- the return-summary
// strip's reference to the previous login. A specific calendar reference
// reads warmer than a raw duration ("since 14 hours ago").
//
// Both days are the user's (settings.timezone), never the process's: the
// server is UTC, so a login at 9pm EDT used to count as the next day. Built
// on the server and passed down as text, so there's nothing for hydration
// to disagree about.
export function sinceLabel(sinceTimestamp: string, today: string, timeZone: string | null): string {
  const since = new Date(sinceTimestamp);
  if (Number.isNaN(since.getTime())) return "your last visit";

  const sinceDay = todayInZone(timeZone, since);
  const dayDiff = daysBetweenInclusive(sinceDay, today) - 1;

  if (dayDiff <= 0) return "earlier today";
  if (dayDiff === 1) return "yesterday";
  if (dayDiff < 7) return weekdayLong.format(parseLocalDate(sinceDay));
  return formatDateShort(sinceDay);
}
