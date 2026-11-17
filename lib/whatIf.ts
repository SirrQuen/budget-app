// "Can I afford it?" (docs/Decide-and-Grow.md, F2), pure.
//
// The answer is the hero's own projection run again with one pretend
// expense added to its one-off future transactions -- the same inputs, the
// same function, the same classifier. There is no second calculation:
// whether it fits is the projection's own signed figure (before the $0
// floor) being >= 0.
//
// Nothing here writes. The pretend expense exists only inside one call.
//
// "Doesn't fit yet": an expense dated d lowers every day's low from d on.
// Dated later it reaches a subset of those days, so the lowest point can
// only stay the same or rise -- once it fits on some day, it fits on every
// later day in the horizon. That makes the earliest day it fits a binary
// search: about six projection runs over a five-to-eight-week horizon, all
// on one load of the inputs.

import { addDaysISO } from "@/lib/date";
import {
  projectSafeToSpend,
  type ProjectedObligation,
  type ProjectionTransaction,
  type SafeToSpendProjection,
  type SafeToSpendProjectionInput,
} from "@/lib/safeToSpendProjection";

/** The pretend expense's id. Never a real row: every door skips it. */
export const WHAT_IF_ID = "what-if";

/** numeric(12,2)'s ceiling, in cents. */
export const MAX_WHAT_IF_CENTS = 999_999_999_999;

export function isWhatIfItem(o: { transactionId: string | null }): boolean {
  return o.transactionId === WHAT_IF_ID;
}

/**
 * "12", "12.5", "1,250.75", "$40" -> integer cents. null for anything that
 * isn't a plain non-negative amount with at most two decimals. Parsed from
 * the digits, never through a float.
 */
export function parseAmountToCents(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, "").replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= MAX_WHAT_IF_CENTS ? cents : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The route's body, checked: integer cents in range and an ISO date. The
 * amount travels only in a POST body -- never a URL, which ends up in logs.
 */
export function parseWhatIfRequest(body: unknown): { cents: number; date: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const { cents, date } = body as Record<string, unknown>;
  if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents < 0 || cents > MAX_WHAT_IF_CENTS) return null;
  if (typeof date !== "string" || !ISO_DATE.test(date)) return null;
  // A real calendar day: "2026-02-31" doesn't round-trip.
  const instant = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(instant) || new Date(instant).toISOString().slice(0, 10) !== date) return null;
  return { cents, date };
}

/** The pretend expense, as the projection reads a one-off future expense leaving the spendable set. */
export function whatIfTransaction(cents: number, date: string): ProjectionTransaction {
  return {
    transactionId: WHAT_IF_ID,
    name: "This",
    kind: "Expense",
    // Any spendable type classifies the same (lib/safeToSpend.ts).
    fromAccountType: "Checking",
    toAccountType: null,
    fromCountsLater: true,
    toCountsLater: false,
    // Dollars at the projection's edge; it converts back to integer cents.
    amount: cents / 100,
    date,
  };
}

/** The same inputs, with the pretend expense added. $0 adds nothing. */
export function withWhatIf(input: SafeToSpendProjectionInput, cents: number, date: string): SafeToSpendProjectionInput {
  if (cents === 0) return input;
  return { ...input, futureTransactions: [...input.futureTransactions, whatIfTransaction(cents, date)] };
}

/** The projection's own verdict: its figure before the $0 floor is not below zero. */
export function fits(projection: Pick<SafeToSpendProjection, "signedSafeToSpend">): boolean {
  return projection.signedSafeToSpend >= 0;
}

/**
 * The first of `dates` (ascending) where `fitsOn` holds, given that once it
 * holds it holds for every later date. null when it holds on none.
 */
export function earliestFitting(dates: readonly string[], fitsOn: (date: string) => boolean): string | null {
  let lo = 0;
  let hi = dates.length; // dates[hi] is the earliest known fit; length = none yet
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fitsOn(dates[mid])) hi = mid;
    else lo = mid + 1;
  }
  return hi < dates.length ? dates[hi] : null;
}

/** Every day after `from`, through `through`. */
function daysAfter(from: string, through: string): string[] {
  const days: string[] = [];
  for (let d = addDaysISO(from, 1); d <= through; d = addDaysISO(d, 1)) days.push(d);
  return days;
}

export type WhatIfAnswer =
  /** The day is past what the forecast covers; nothing was projected for it. */
  | { kind: "beyond"; horizonEnd: string }
  /** The day is before the user's today. */
  | { kind: "past"; today: string }
  | {
      kind: "answer";
      horizonEnd: string;
      /** The hero's figure and tightest day, as they stand. */
      before: { safeToSpend: number; troughDate: string };
      after: {
        safeToSpend: number;
        signedSafeToSpend: number;
        troughDate: string;
        /** What comes out on the new tightest day, the pretend one as "This". Real items first. */
        troughItems: string[];
      };
      fits: boolean;
      /** Not fitting: the earliest later day in the horizon it would. null when it fits, or when none does. */
      earliestFit: string | null;
    };

function troughItems(obligations: ProjectedObligation[]): string[] {
  const real = [...obligations].filter((o) => !isWhatIfItem(o)).sort((a, b) => b.amount - a.amount);
  return [...real.map((o) => o.name), ...(obligations.some(isWhatIfItem) ? ["This"] : [])];
}

/** The whole answer from one load of inputs: the hero, the pretend, and -- only when it doesn't fit -- the search. */
export function answerWhatIf(input: SafeToSpendProjectionInput, cents: number, date: string): WhatIfAnswer {
  if (date < input.today) return { kind: "past", today: input.today };
  const base = projectSafeToSpend(input);
  if (date > base.horizonEnd) return { kind: "beyond", horizonEnd: base.horizonEnd };

  const run = (on: string) => projectSafeToSpend(withWhatIf(input, cents, on));
  const result = run(date);
  const ok = fits(result);
  const earliestFit = ok ? null : earliestFitting(daysAfter(date, base.horizonEnd), (d) => fits(run(d)));

  return {
    kind: "answer",
    horizonEnd: base.horizonEnd,
    before: { safeToSpend: base.safeToSpend, troughDate: base.trough.date },
    after: {
      safeToSpend: result.safeToSpend,
      signedSafeToSpend: result.signedSafeToSpend,
      troughDate: result.trough.date,
      troughItems: troughItems(result.trough.obligations),
    },
    fits: ok,
    earliestFit,
  };
}
