import { todayISO, addDaysISO, daysBetweenInclusive } from "@/lib/date";

// The dashboard's "Over time" region is scoped by a single date range, held
// in the URL (?range= for a preset, ?from=&to= for a custom span). Everything
// downstream -- the income/spending tiles, their sparklines and deltas, the
// category-movement comparison, the cash-flow chart's shaded band -- derives
// from the DashboardRange this module resolves. Pure date math, no DB.

export type DashboardRangePreset = "mtd" | "7d" | "30d" | "90d" | "custom";

export type DashboardRange = {
  preset: DashboardRangePreset;
  /** Inclusive ISO "YYYY-MM-DD" bounds of the selected window. */
  from: string;
  to: string;
  /**
   * The comparison window the tile deltas and category movement measure
   * against. For the presets it's the equal-length span immediately before
   * `from`; for the month-to-date default it's the same day span in the
   * previous calendar month, so days 1-3 don't read as "nothing happened".
   */
  prevFrom: string;
  prevTo: string;
  /** Names the comparison window in the UI, e.g. "previous 30 days". */
  prevLabel: string;
  /** Sparkline granularity -- ~daily up to a month, weekly to six, monthly beyond. */
  bucket: "day" | "week" | "month";
};

type RawParam = string | string[] | undefined;

function first(value: RawParam): string {
  return typeof value === "string" ? value : "";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidISODate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function bucketFor(from: string, to: string): DashboardRange["bucket"] {
  const span = daysBetweenInclusive(from, to);
  if (span <= 31) return "day";
  if (span <= 180) return "week";
  return "month";
}

// The equal-length window ending the day before `from`.
function precedingWindow(from: string, days: number): { prevFrom: string; prevTo: string } {
  const prevTo = addDaysISO(from, -1);
  const prevFrom = addDaysISO(prevTo, -(days - 1));
  return { prevFrom, prevTo };
}

// First of the month through the same day-of-month, one calendar month back.
// The day is clamped to the previous month's length (Mar 31 -> Feb 28/29).
function sameSpanPreviousMonth(todayIso: string): { prevFrom: string; prevTo: string } {
  const [y, m, d] = todayIso.split("-").map(Number);
  const pm = new Date(y, m - 2, 1);
  const pmYear = pm.getFullYear();
  const pmMonth = pm.getMonth();
  const lastDay = new Date(pmYear, pmMonth + 1, 0).getDate();
  const mm = String(pmMonth + 1).padStart(2, "0");
  return {
    prevFrom: `${pmYear}-${mm}-01`,
    prevTo: `${pmYear}-${mm}-${String(Math.min(d, lastDay)).padStart(2, "0")}`,
  };
}

function presetDays(preset: "7d" | "30d" | "90d"): number {
  return preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
}

export function resolveDashboardRange(params: {
  range?: RawParam;
  from?: RawParam;
  to?: RawParam;
}): DashboardRange {
  const today = todayISO();
  const rangeParam = first(params.range);
  const fromParam = first(params.from);
  const toParam = first(params.to);

  if (rangeParam === "7d" || rangeParam === "30d" || rangeParam === "90d") {
    const days = presetDays(rangeParam);
    const from = addDaysISO(today, -(days - 1));
    return {
      preset: rangeParam,
      from,
      to: today,
      ...precedingWindow(from, days),
      prevLabel: `previous ${days} days`,
      bucket: bucketFor(from, today),
    };
  }

  if (
    isValidISODate(fromParam) &&
    isValidISODate(toParam) &&
    fromParam <= toParam
  ) {
    const days = daysBetweenInclusive(fromParam, toParam);
    return {
      preset: "custom",
      from: fromParam,
      to: toParam,
      ...precedingWindow(fromParam, days),
      prevLabel: `previous ${days} day${days === 1 ? "" : "s"}`,
      bucket: bucketFor(fromParam, toParam),
    };
  }

  // Default: month to date, compared against the same span last month.
  const from = `${today.slice(0, 7)}-01`;
  return {
    preset: "mtd",
    from,
    to: today,
    ...sameSpanPreviousMonth(today),
    prevLabel: "same days last month",
    bucket: bucketFor(from, today),
  };
}

// Serialises a range back to the query string the filter navigates to.
// The month-to-date default carries no params, so a pristine /dashboard URL
// stays clean.
export function dashboardRangeToQuery(range: DashboardRange): string {
  const usp = new URLSearchParams();
  if (range.preset === "custom") {
    usp.set("from", range.from);
    usp.set("to", range.to);
  } else if (range.preset !== "mtd") {
    usp.set("range", range.preset);
  }
  return usp.toString();
}
