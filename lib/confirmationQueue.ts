// The confirmation queue: which recurring occurrences are waiting for the
// user to say what happened. Pure, so every case is unit tested
// (lib/confirmationQueue.test.ts). The one source for every surface that
// asks -- the dashboard's queue, its count, the recurring page's section.
// Never re-derive "needs confirming" anywhere else.
//
// A schedule never writes a transaction; only a confirmation does
// (CLAUDE.md "Confirmation creates every recurring transaction"). So an
// occurrence sits here until it's answered, and is counted by the
// projection meanwhile -- the queue is housekeeping for the ledger, never
// an input to the forecast.
//
// Built from the same ProjectionSchedule rows as the projection, and the
// same occurrence expansion (expandOccurrences), so the two can't disagree
// about which occurrences exist.
//
// Timing (CLAUDE.md "Prompt timing"): an occurrence enters the queue on
// confirmationOpensOn -- its expected date minus date_tolerance_days, the
// earliest it could land. A fixed-date schedule opens on the expected date
// itself. It stays until answered: an occurrence that has dropped out of
// the projection (income past its late edge) is still confirmable here.
//
// One item per schedule: a schedule has one cursor (next_run_date), and
// confirming or skipping advances it one cycle. When more than one cycle
// is open, the item says how many.

import { addDaysISO } from "@/lib/date";
import { confirmationOpensOn } from "@/lib/recurringSchedule";
import { expandOccurrences, type ProjectionSchedule } from "@/lib/safeToSpendProjection";

export type ConfirmationItem = {
  /** confirmationKey(recurringId, dueDate) -- one occurrence of one schedule. */
  key: string;
  recurringId: string;
  name: string;
  kind: ProjectionSchedule["kind"];
  /** Source account (where Income lands, where an outflow or transfer leaves). */
  accountId: string;
  /** Destination for a Transfer; null otherwise. */
  toAccountId: string | null;
  /** The predicted amount, dollars -- what "landed as expected" writes. */
  amount: number;
  isEstimate: boolean;
  /** The predicted (business-day-resolved) date -- next_due_date. */
  dueDate: string;
  /** date_tolerance_days > 0: the date is an estimate, so the UI leads with it. */
  approximate: boolean;
  /** Open cycles for this schedule, this one included. 1 in the common case. */
  outstanding: number;
};

export function confirmationKey(recurringId: string, dueDate: string): string {
  return `${recurringId}:${dueDate}`;
}

/**
 * Every occurrence waiting on the user, earliest first.
 *
 * `later` holds the keys answered "hasn't landed yet" today -- hidden until
 * tomorrow, nothing written, and the projection never reads it.
 */
export function buildConfirmationQueue(
  schedules: ProjectionSchedule[],
  today: string,
  holidays: ReadonlySet<string>,
  later: ReadonlySet<string> = new Set(),
): ConfirmationItem[] {
  const items: ConfirmationItem[] = [];

  for (const s of schedules) {
    const tolerance = s.dateToleranceDays;
    // An occurrence is open once its early edge is today or before, i.e.
    // its due date is no later than today + tolerance.
    const open = expandOccurrences(s, addDaysISO(today, tolerance), holidays).filter(
      (o) => confirmationOpensOn(o.due, tolerance) <= today,
    );
    if (open.length === 0) continue;

    const dueDate = open[0].due;
    const key = confirmationKey(s.recurringId, dueDate);
    if (later.has(key)) continue;

    items.push({
      key,
      recurringId: s.recurringId,
      name: s.name,
      kind: s.kind,
      accountId: s.accountId,
      toAccountId: s.toAccountId,
      amount: s.amount,
      isEstimate: s.isEstimate,
      dueDate,
      approximate: tolerance > 0,
      outstanding: open.length,
    });
  }

  return items.sort((a, b) =>
    a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.name.localeCompare(b.name),
  );
}

/** "4 to confirm" -- the queue's only headline. Never "overdue". */
export function confirmationCountLabel(count: number): string {
  return `${count} to confirm`;
}

export type BulkConfirmResult = { confirmed: number; errors: string[] };

/**
 * Bulk confirm's loop, kept here so it's tested without a database: each
 * item answered once, in order, independently -- a failure is reported and
 * the rest still go through. "Already answered" (another tab got there
 * first) is neither a confirmation nor an error.
 */
export async function confirmEach<T>(
  items: T[],
  confirmOne: (item: T) => Promise<{ data: "answered" | "already_answered" | null; error: string | null }>,
): Promise<BulkConfirmResult> {
  const result: BulkConfirmResult = { confirmed: 0, errors: [] };
  for (const item of items) {
    const res = await confirmOne(item);
    if (res.error !== null) result.errors.push(res.error);
    else if (res.data === "answered") result.confirmed += 1;
  }
  return result;
}
