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

// timeZone: "UTC" is deliberate -- Postgres `date` columns (transaction_date,
// etc.) have no time component, but a plain "2026-08-19" string is still
// parsed by `new Date()` as UTC midnight. Without pinning the formatter to
// UTC too, any viewer west of Greenwich would see that calendar date roll
// back a day (e.g. today, entered and stored as "2026-08-19", displaying as
// "Aug 18"). Pinning both sides to UTC makes the displayed day match the
// stored day regardless of the viewer's local timezone.
const mediumDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

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

/** "Aug 16, 2026" for an ISO date string or a Date. */
export function formatDate(date: string | Date): string {
  return mediumDate.format(typeof date === "string" ? new Date(date) : date);
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
