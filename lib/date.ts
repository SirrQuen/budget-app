// The user's calendar day, as "YYYY-MM-DD", in an explicit IANA zone --
// never the process's own zone. On the server that zone is the host's
// (UTC in production), which moved "today" forward at 8pm EDT; every
// "today" in the app now comes from here with settings.timezone (server:
// getToday() in lib/db/settings.ts; client: useToday() in
// components/TodayProvider). null, or a name Intl doesn't know, is UTC --
// the same fallback the database's apply_user_timezone() uses, so the two
// sides never disagree about the day.
export function todayInZone(timeZone: string | null, now: Date = new Date()): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = dayFormatter(timeZone ?? "UTC").formatToParts(now);
  } catch (error) {
    warnUnknownZone(timeZone, error);
    parts = dayFormatter("UTC").formatToParts(now);
  }
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// The UTC fallback is deliberate (it matches apply_user_timezone()), but a
// zone Intl rejects is still worth knowing about. todayInZone runs on every
// render and TodayProvider tick, so once per zone per process, not per call.
const warnedZones = new Set<string | null>();
function warnUnknownZone(timeZone: string | null, error: unknown): void {
  if (warnedZones.has(timeZone)) return;
  warnedZones.add(timeZone);
  console.warn(`[date] unknown time zone ${JSON.stringify(timeZone)}; using UTC:`, error);
}

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

// Whether Intl accepts `timeZone` as a zone name -- the check a browser
// reported zone passes before it's stored in settings.timezone.
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// First of the month `dateISO` falls in.
export function monthStartISO(dateISO: string): string {
  return `${dateISO.slice(0, 7)}-01`;
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
// date string, staying in plain calendar-day terms the same way todayInZone()
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
