// "Is this the same bill?" (docs/Views-Search-Import-Layout.md, item 4).
//
// A schedule's next occurrence and a future-dated entry the person typed
// in for the same bill both reach the forecast since migration 65 -- one
// bill, subtracted twice. The app can't know they're one event, so where
// they coincide it asks. This file is THE match: the dashboard's Upcoming
// list, the after-save question and the server's check before writing an
// answer all read it. Never restate it.
//
// Deliberately narrow -- it is not a duplicate detector. One side is
// always a schedule's NEXT occurrence (the only one an answer can step
// past: the schedule keeps one cursor), the other an unlinked entry dated
// after today, and they must share account (both ends, for a transfer),
// direction and exact amount, dated within the schedule's own tolerance.
// Two arbitrary transactions are never compared, and nothing is merged
// without the person's answer.
//
// The answers and writes live in SQL (migration 66): confirm_same_bill(),
// record_different_bill(), clear_different_bill(), and the delete trigger
// that puts an occurrence back.

import { daysBetweenInclusive } from "./date";
import { formatDayMonth } from "./format";

export type SameBillSchedule = {
  recurringId: string;
  name: string;
  kind: "Income" | "Expense" | "Transfer";
  accountId: string;
  toAccountId: string | null;
  /** The amount shown for the next occurrence (v_upcoming_recurring.amount), dollars. */
  amount: number;
  /** The cursor -- what an answer claims on. Never shown. */
  nextRunDate: string;
  /** The next occurrence's date, as shown and counted. */
  nextDueDate: string;
  dateToleranceDays: number;
  endDate: string | null;
  occurrencesRemaining: number | null;
};

export type SameBillEntry = {
  /** A transfer's Expense leg stands for both. */
  transactionId: string;
  kind: "Income" | "Expense" | "Transfer";
  accountId: string;
  toAccountId: string | null;
  /** Dollars, positive. */
  amount: number;
  date: string;
  /** Already carries a recurringid -- some schedule's occurrence. */
  linked: boolean;
};

export type SameBillPair = {
  recurringId: string;
  transactionId: string;
  name: string;
  amount: number;
  kind: "Income" | "Expense" | "Transfer";
  /** The schedule's occurrence date. */
  dueDate: string;
  /** The schedule's cursor at that occurrence -- the claim. */
  runDate: string;
  entryDate: string;
};

export function sameBillKey(recurringId: string, transactionId: string): string {
  return `${recurringId}:${transactionId}`;
}

const cents = (dollars: number) => Math.round(dollars * 100);
const gapDays = (a: string, b: string) => Math.abs(daysBetweenInclusive(a, b) - 1);

/**
 * Every unanswered pair, at most one per schedule and one per entry --
 * the closest dates win, then the earlier entry, then ids, so the result
 * doesn't depend on input order.
 *
 * `answered` holds sameBillKey()s with any answer: "No, keep both" is
 * never asked again, and a "Yes" leaves the entry linked anyway.
 */
export function findSameBillPairs(
  schedules: readonly SameBillSchedule[],
  entries: readonly SameBillEntry[],
  answered: ReadonlySet<string>,
  today: string,
): SameBillPair[] {
  const candidates: { s: SameBillSchedule; e: SameBillEntry; gap: number }[] = [];
  for (const s of schedules) {
    if (s.occurrencesRemaining !== null && s.occurrencesRemaining <= 0) continue;
    if (s.endDate !== null && s.endDate < s.nextDueDate) continue;
    for (const e of entries) {
      if (e.linked || e.date <= today) continue;
      if (e.kind !== s.kind || e.accountId !== s.accountId) continue;
      if ((e.toAccountId ?? null) !== (s.toAccountId ?? null)) continue;
      if (cents(e.amount) !== cents(s.amount)) continue;
      const gap = gapDays(s.nextDueDate, e.date);
      if (gap > s.dateToleranceDays) continue;
      if (answered.has(sameBillKey(s.recurringId, e.transactionId))) continue;
      candidates.push({ s, e, gap });
    }
  }

  candidates.sort(
    (x, y) =>
      x.gap - y.gap ||
      (x.e.date < y.e.date ? -1 : x.e.date > y.e.date ? 1 : 0) ||
      (x.s.recurringId < y.s.recurringId ? -1 : x.s.recurringId > y.s.recurringId ? 1 : 0) ||
      (x.e.transactionId < y.e.transactionId ? -1 : x.e.transactionId > y.e.transactionId ? 1 : 0),
  );

  const usedSchedules = new Set<string>();
  const usedEntries = new Set<string>();
  const pairs: SameBillPair[] = [];
  for (const { s, e } of candidates) {
    if (usedSchedules.has(s.recurringId) || usedEntries.has(e.transactionId)) continue;
    usedSchedules.add(s.recurringId);
    usedEntries.add(e.transactionId);
    pairs.push({
      recurringId: s.recurringId,
      transactionId: e.transactionId,
      name: s.name,
      amount: s.amount,
      kind: s.kind,
      dueDate: s.nextDueDate,
      runDate: s.nextRunDate,
      entryDate: e.date,
    });
  }
  return pairs.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

/**
 * The question's second line, around the amount (rendered by <Amount>
 * between `before` and `after`). Facts and days, no alarm.
 */
export function sameBillQuestionParts(pair: SameBillPair): { before: string; after: string } {
  if (pair.entryDate === pair.dueDate) {
    return {
      before: `${pair.name} · `,
      after: ` · ${formatDayMonth(pair.dueDate)} appears twice — once from your schedule, once as an entry you added.`,
    };
  }
  return {
    before: `${pair.name} · `,
    after: ` appears twice — your schedule expects it on ${formatDayMonth(pair.dueDate)}, and you added an entry for ${formatDayMonth(pair.entryDate)}.`,
  };
}

/** A "No, keep both" on the transaction's own screen, with "Change your answer" beside it. */
export function differentBillLine(scheduleName: string, occurrenceDueDate: string): string {
  return `You said this isn't ${scheduleName}'s ${formatDayMonth(occurrenceDueDate)} payment.`;
}

export type SameBillDeletePreview = {
  transactionId: string;
  transferGroupId: string | null;
  scheduleName: string;
  occurrenceDueDate: string;
  /** same_bill_restores(): deleting puts the occurrence back on the schedule. */
  restores: boolean;
  /** The schedule's next date now -- where it picks up when nothing is restored. */
  resumesOn: string;
};

/**
 * What deleting an entry answered "same bill" does to the forecast, said
 * in the delete confirmation. When the occurrence can't be put back the
 * bill is in neither place, so the confirmation says so plainly before
 * anything is removed.
 */
export function sameBillDeleteNote(p: SameBillDeletePreview): string {
  const occurrence = `${p.scheduleName} for ${formatDayMonth(p.occurrenceDueDate)}`;
  return p.restores
    ? `${occurrence} goes back on your schedule, so it stays in your forecast.`
    : `${occurrence} won't be in your forecast after this. Your schedule picks up again on ${formatDayMonth(p.resumesOn)}.`;
}

/** Delete notes keyed the way the list keys a row: a transfer by its group, anything else by id. */
export function sameBillDeleteNotes(previews: readonly SameBillDeletePreview[]): Record<string, string> {
  const notes: Record<string, string> = {};
  for (const p of previews) {
    notes[p.transferGroupId ?? p.transactionId] = sameBillDeleteNote(p);
  }
  return notes;
}
