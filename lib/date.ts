// Local calendar day, not UTC -- toISOString() alone can land on yesterday
// or tomorrow depending on the user's timezone offset.
export function todayISO(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

// Builds a Date at LOCAL midnight from a Postgres `date` column's bare
// "YYYY-MM-DD" -- new Date(dateISO) parses that as UTC midnight instead,
// which renders a day early once formatted in any negative-offset zone
// (e.g. America/New_York). Shared by every Intl.DateTimeFormat in the app
// that displays one of these values (lib/format.ts, lib/recurringSchedule.ts,
// CashflowChart), so the parse and the (local-zone) format always agree.
export function parseLocalDate(dateISO: string): Date {
  const [year, month, day] = dateISO.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// Adds (or subtracts, for negative delta) whole days to an ISO "YYYY-MM-DD"
// date string, staying in local-calendar-day terms the same way todayISO()
// does -- never routes through a UTC-midnight Date for the input.
export function addDaysISO(dateISO: string, delta: number): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  const d = new Date(year, month - 1, day + delta);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Last calendar day of the month that `dateISO` ("YYYY-MM-DD") falls in.
// Day 0 of the following month is that month's last day; local-calendar
// terms throughout, matching addDaysISO.
export function endOfMonthISO(dateISO: string): string {
  const [year, month] = dateISO.split("-").map(Number);
  const d = new Date(year, month, 0);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Whole calendar days from `fromISO` through `toISO`, counting both ends --
// so daysBetweenInclusive("2026-08-29", "2026-08-31") is 3. Both inputs are
// plain calendar dates with no time-of-day, so UTC-epoch math is exact and
// DST-safe (same approach as dashboard.ts's isNextCalendarDay).
export function daysBetweenInclusive(fromISO: string, toISO: string): number {
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
}
