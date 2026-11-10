import { parseLocalDate } from "@/lib/date";

// "October" for a budget month ("2026-10-01"); "October 2025" when it isn't
// in the same year as `relativeTo` (the month being viewed), so a budget
// carried across a new year still says where it came from. Parsed as a
// local date, never new Date("YYYY-MM-DD"), which reads as the previous
// day west of UTC.
export function formatMonthName(monthISO: string, relativeTo?: string): string {
  const sameYear = relativeTo === undefined || monthISO.slice(0, 4) === relativeTo.slice(0, 4);
  return parseLocalDate(monthISO).toLocaleDateString("en-US", {
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** "carried from October" -- the label a carried budget wears. */
export function carriedFromLabel(carriedFrom: string, viewedMonth: string): string {
  return `carried from ${formatMonthName(carriedFrom, viewedMonth)}`;
}
