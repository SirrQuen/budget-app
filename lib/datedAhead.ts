// A transaction dated after the user's today doesn't count toward its
// account's balance until that date (counts_in_balance, migration 65).
// This file is the list's DISPLAY of that state -- the ghosted row and its
// date chip -- and the one-time "settle" when the date arrives. It decides
// nothing about money: balances come from SQL, and the anchor half of the
// rule never shows here (a pre-anchor row isn't "dated ahead", it's
// answered).
//
// `today` is always the user's day (useToday()), never the process clock.

/** Dated after today: shown ghosted with its date, not yet in the balance. */
export function isDatedAhead(transactionDate: string, today: string): boolean {
  return transactionDate > today;
}

/** localStorage key: ids this browser has shown dated ahead and not yet seen settle. */
export const DATED_AHEAD_STORAGE_KEY = "sorrel.datedAhead";

/** Bound on remembered ids -- a deleted future row is never seen settling. */
export const DATED_AHEAD_MAX_REMEMBERED = 500;

/**
 * Which rows settle now, and what to remember next. A row settles -- once
 * -- when this browser showed it dated ahead before and it no longer is.
 * Rows dated ahead now are remembered; settled ones are forgotten, so the
 * animation never plays twice. Ids not on screen are kept (another page,
 * another filter), oldest dropped past the bound.
 */
export function settleRows(
  remembered: readonly string[],
  rows: readonly { key: string; datedAhead: boolean }[],
): { settling: string[]; remember: string[] } {
  const known = new Set(remembered);
  const settling: string[] = [];
  const ahead: string[] = [];
  for (const r of rows) {
    if (r.datedAhead) {
      if (!known.has(r.key)) ahead.push(r.key);
    } else if (known.has(r.key)) {
      settling.push(r.key);
      known.delete(r.key);
    }
  }
  const remember = [...known, ...ahead];
  return { settling, remember: remember.slice(Math.max(0, remember.length - DATED_AHEAD_MAX_REMEMBERED)) };
}

/** Reads the remembered ids; [] when storage is unavailable or garbled. */
export function readRemembered(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
