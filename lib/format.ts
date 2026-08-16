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

const mediumDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** Full-precision currency for a single figure -- a transaction row, a line item. */
export function formatCurrency(amount: number): string {
  return currency.format(amount);
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
 * Income renders with a leading + and an up arrow, Expense with a minus and
 * a down arrow, so direction is legible from the glyphs alone -- colour is
 * a bonus, never the only signal.
 */
export function formatSignedAmount(
  amount: number,
  type: "Income" | "Expense",
): { text: string; arrow: "↑" | "↓"; tone: Tone } {
  const isIncome = type === "Income";
  return {
    text: `${isIncome ? "+" : "−"}${formatCurrency(Math.abs(amount))}`,
    arrow: isIncome ? "↑" : "↓",
    tone: isIncome ? "good" : "critical",
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
