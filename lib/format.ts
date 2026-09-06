import { isLiabilityAccountType } from "@/lib/accountOptions";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const plainNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

// No explicit timeZone -- date-only strings are parsed to LOCAL midnight
// (see parseDisplayDate below), so formatting in the viewer's own zone
// lands back on that same calendar day. Pinning this to UTC while parsing
// local would shift the day again for any positive-offset viewer.
const mediumDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Postgres `date` columns (transaction_date, opening_date, budget periods,
// recurring dates, ...) arrive as a bare "YYYY-MM-DD" with no time or zone.
// `new Date("2026-03-06")` parses that as UTC midnight, which renders as
// Mar 5 once formatted in any negative-offset zone (e.g. America/New_York).
// Building the Date from its year/month/day parts instead -- the same
// local-calendar-day approach as lib/date.ts's todayISO/addDaysISO -- keeps
// the parse and the format (which now also runs in the local zone) on the
// same basis, so the displayed day always matches the stored day.
//
// Returns null for anything that doesn't parse to a real date, so callers
// can render a blank rather than crash on Intl.DateTimeFormat.format
// throwing on an Invalid Date.
function parseDisplayDate(date: string | Date): Date | null {
  if (date instanceof Date) {
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (ISO_DATE_ONLY.test(date)) {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Full-precision currency for a single figure -- a transaction row, a line item. */
export function formatCurrency(amount: number): string {
  return currency.format(amount);
}

/**
 * An account balance for display. Credit Card and Loan balances are stored
 * negative (accounts_liability_sign) -- the math stays negative, but this
 * reads as a plain positive amount + "owed", never a minus sign.
 */
export function formatAccountBalance(balance: number, accountType: string): string {
  if (isLiabilityAccountType(accountType)) {
    return `${formatCurrency(Math.abs(balance))} owed`;
  }
  return formatCurrency(balance);
}

/**
 * "Aug 16, 2026" for an ISO date string or a Date. Never throws -- this is
 * shared across the whole app, so a malformed value renders as an empty
 * string rather than crashing whatever page it's embedded in.
 */
export function formatDate(date: string | Date): string {
  try {
    const parsed = parseDisplayDate(date);
    return parsed ? mediumDate.format(parsed) : "";
  } catch {
    return "";
  }
}

/**
 * "Aug 16" -- no year, for compact rows where the year is obvious. Same
 * never-throws contract as formatDate.
 */
export function formatDateShort(date: string | Date): string {
  try {
    const parsed = parseDisplayDate(date);
    return parsed ? shortDate.format(parsed) : "";
  } catch {
    return "";
  }
}

/**
 * A big standalone figure that compacts once it gets large: 1,284 / 12.9K /
 * $4.2M. For StatTile and other hero-ish numbers -- never for a value
 * sitting in a table column (use formatCurrency there instead).
 */
export function formatCompactNumber(value: number, opts: { currency?: boolean } = {}): string {
  const isLarge = Math.abs(value) >= 10_000;
  if (opts.currency) {
    return (isLarge ? compactCurrency : currency).format(value);
  }
  return (isLarge ? compactNumber : plainNumber).format(value);
}

export type Tone = "good" | "critical" | "neutral";

/**
 * Income renders with a leading + and Expense with a minus, so direction is
 * legible from the sign alone. Only income gets a tone -- an expense is a
 * plain, ordinary value, not a warning, so it stays neutral rather than
 * critical.
 */
export function formatSignedAmount(
  amount: number,
  type: "Income" | "Expense",
): { text: string; tone: Tone } {
  const isIncome = type === "Income";
  return {
    text: `${isIncome ? "+" : "−"}${formatCurrency(Math.abs(amount))}`,
    tone: isIncome ? "good" : "neutral",
  };
}

/** A change versus a comparison period -- e.g. StatTile's delta line. */
export function formatDelta(
  value: number,
  opts: { format?: "currency" | "number" | "percent" } = {},
): { text: string; arrow: "↑" | "↓" | "→"; tone: Tone } {
  const format = opts.format ?? "number";
  const tone: Tone = value > 0 ? "good" : value < 0 ? "critical" : "neutral";
  const arrow = value > 0 ? "↑" : value < 0 ? "↓" : "→";
  const abs = Math.abs(value);
  const magnitude =
    format === "currency"
      ? formatCurrency(abs)
      : format === "percent"
        ? `${abs.toFixed(1)}%`
        : plainNumber.format(abs);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return { text: `${sign}${magnitude}`, arrow, tone };
}
