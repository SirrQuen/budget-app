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
//
// Two states, one item (docs/Budgets-Reminders-and-Pending.md, item 1):
//
//   coming-up   from COMING_UP_DAYS before the due date until the confirm
//               window opens -- "Rent · $1,850 · Friday". Nothing to
//               answer yet; dismissible until the window opens.
//   to-confirm  from the confirm window's opening on -- "Did Rent come
//               out?" The four answers.
//
// The item seen Monday is the item confirmed Friday: same schedule, same
// occurrence, same key. When the confirm window opens early (date
// tolerance), IT is the reminder: coming-up runs only until it opens, so a
// tolerance of COMING_UP_DAYS or more leaves no coming-up span at all.
// Correct, not a gap. Coming-up is never counted, never confirmed in
// bulk, never an input to anything.

import { addDaysISO, daysBetweenInclusive } from "@/lib/date";
import type { AmountBasis } from "@/lib/amountBasis";
import { confirmationOpensOn, paydayWindowEnd } from "@/lib/recurringSchedule";
import { paymentPayee, type PaymentPayee } from "@/lib/accountOptions";
import { expandOccurrences, type ProjectionSchedule } from "@/lib/safeToSpendProjection";

/** How far ahead an occurrence shows as coming up. */
export const COMING_UP_DAYS = 5;

export type QueueState = "coming-up" | "to-confirm";

export type ConfirmationItem = {
  /** confirmationKey(recurringId, dueDate) -- one occurrence of one schedule. */
  key: string;
  /** Coming up (a reminder, nothing to answer) or to confirm (the four answers). */
  state: QueueState;
  recurringId: string;
  name: string;
  kind: ProjectionSchedule["kind"];
  /** Source account (where Income lands, where an outflow or transfer leaves). */
  accountId: string;
  /** Destination for a Transfer; null otherwise. */
  toAccountId: string | null;
  /** A transfer paying a card or loan -- the UI says confirming it moves no money (PaymentNote). */
  payee: PaymentPayee | null;
  /** The predicted amount, dollars -- what "landed as expected" writes. */
  amount: number;
  isEstimate: boolean;
  /** What amount rests on -- shown beside it ("average of last 3"). */
  basis: AmountBasis;
  /** The predicted (business-day-resolved) date -- next_due_date. */
  dueDate: string;
  /** date_tolerance_days > 0: the date is an estimate, so the UI leads with it. */
  approximate: boolean;
  /** The schedule's date_tolerance_days -- the window alreadyRecorded checks. */
  dateToleranceDays: number;
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
 * `dismissed` holds coming-up keys the person said "got it" to -- hidden
 * until the confirm window opens, when the same item asks as usual.
 */
export function buildConfirmationQueue(
  schedules: ProjectionSchedule[],
  today: string,
  holidays: ReadonlySet<string>,
  later: ReadonlySet<string> = new Set(),
  dismissed: ReadonlySet<string> = new Set(),
): ConfirmationItem[] {
  const items: ConfirmationItem[] = [];

  for (const s of schedules) {
    const tolerance = s.dateToleranceDays;
    // Far enough ahead to see both an occurrence that's open (its due date
    // is no later than today + tolerance) and one that's coming up (due
    // within COMING_UP_DAYS).
    const occurrences = expandOccurrences(
      s,
      addDaysISO(today, Math.max(tolerance, COMING_UP_DAYS)),
      holidays,
    );
    const open = occurrences.filter((o) => confirmationOpensOn(o.due, tolerance) <= today);

    let state: QueueState;
    let dueDate: string;
    if (open.length > 0) {
      state = "to-confirm";
      dueDate = open[0].due;
    } else {
      const next = occurrences[0];
      if (!next || !isComingUp(next.due, tolerance, today)) continue;
      state = "coming-up";
      dueDate = next.due;
    }

    const key = confirmationKey(s.recurringId, dueDate);
    if (state === "to-confirm" && later.has(key)) continue;
    if (state === "coming-up" && dismissed.has(key)) continue;

    items.push({
      key,
      state,
      recurringId: s.recurringId,
      name: s.name,
      kind: s.kind,
      accountId: s.accountId,
      toAccountId: s.toAccountId,
      payee: s.kind === "Transfer" ? paymentPayee(s.toAccountType) : null,
      amount: s.amount,
      isEstimate: s.isEstimate,
      basis: s.amountBasis,
      dueDate,
      approximate: tolerance > 0,
      dateToleranceDays: tolerance,
      outstanding: Math.max(open.length, 1),
    });
  }

  // To confirm first, then coming up; each earliest first.
  return items.sort((a, b) =>
    a.state !== b.state
      ? a.state === "to-confirm"
        ? -1
        : 1
      : a.dueDate < b.dueDate
        ? -1
        : a.dueDate > b.dueDate
          ? 1
          : a.name.localeCompare(b.name),
  );
}

/**
 * Coming up: from COMING_UP_DAYS before the due date until the confirm
 * window opens (confirmationOpensOn). Empty when the tolerance is
 * COMING_UP_DAYS or more -- the early-opening window is the reminder.
 */
export function isComingUp(dueDate: string, toleranceDays: number, today: string): boolean {
  return addDaysISO(dueDate, -COMING_UP_DAYS) <= today && today < confirmationOpensOn(dueDate, toleranceDays);
}

/** The items that are to confirm -- the ones counted and confirmed in bulk. */
export function toConfirmItems<T extends { state: QueueState }>(items: T[]): T[] {
  return items.filter((i) => i.state === "to-confirm");
}

/**
 * The to-confirm question. "Did Rent come out?" -- plain, never "overdue",
 * never "due soon".
 */
export function confirmQuestion(item: Pick<ConfirmationItem, "name" | "kind">): string {
  if (item.kind === "Income") return `Did ${item.name} land?`;
  if (item.kind === "Transfer") return `Did ${item.name} go through?`;
  return `Did ${item.name} come out?`;
}

/** A transaction already carrying the schedule's recurringid. */
export type RecordedOccurrence = { date: string; amount: number };

/**
 * The transaction, if any, that already records this occurrence: one
 * carrying THIS schedule's recurringid, dated inside the occurrence's
 * window (due date give or take date_tolerance_days; the day itself for a
 * fixed date). Confirming then would write it twice, so the queue says so
 * before anything is written, and a one-tap confirm is refused.
 *
 * Deliberately narrow. It never looks at unlinked rows, amounts or
 * descriptions: two $5 coffees on a Tuesday are two coffees, and a warning
 * that fires on them gets dismissed by reflex. The case it exists for is
 * "Make recurring", whose source row is linked as the first occurrence
 * (migration 60) -- if the schedule's first date is moved back onto it,
 * this catches it.
 */
export function alreadyRecorded(
  dueDate: string,
  dateToleranceDays: number,
  linked: readonly RecordedOccurrence[],
): RecordedOccurrence | null {
  const from = confirmationOpensOn(dueDate, dateToleranceDays);
  const to = paydayWindowEnd(dueDate, dateToleranceDays);
  const hits = linked.filter((t) => t.date >= from && t.date <= to);
  if (hits.length === 0) return null;
  // The closest to the due date, earliest on a tie.
  const distance = (d: string) => Math.abs(daysBetweenInclusive(dueDate, d) - 1);
  return hits.reduce((best, t) =>
    distance(t.date) < distance(best.date) || (distance(t.date) === distance(best.date) && t.date < best.date)
      ? t
      : best,
  );
}

/**
 * transactions.is_estimated for a confirmed occurrence: TRUE when the
 * amount was never supplied by a person (CLAUDE.md "is_estimated").
 *
 * `predictedIsEstimate` is v_upcoming_recurring.is_estimated_amount -- a
 * variable schedule with no statement amount entered. A one-tap "It
 * landed" on one confirms the event, not the amount, so it's estimated. A
 * fixed schedule's amount is the one the user stated, and a statement
 * amount is one they typed, so those aren't.
 *
 * "It was different" pre-fills the predicted amount. Saving it unchanged
 * is the same guess with a form around it, so it stays estimated; an
 * amount the person changed is theirs. Compared in cents.
 */
export function confirmedAmountIsEstimated(
  predictedIsEstimate: boolean,
  predictedAmount: number,
  enteredAmount?: number,
): boolean {
  if (!predictedIsEstimate) return false;
  if (enteredAmount === undefined) return true;
  return Math.round(enteredAmount * 100) === Math.round(predictedAmount * 100);
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
