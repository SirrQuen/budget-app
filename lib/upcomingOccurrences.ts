// The dashboard's Upcoming list, built from the safe-to-spend projection
// itself -- never from a separate query -- so the list and the number beside
// it can't disagree. Every occurrence the projection counts appears here,
// bills and income mixed, in the order the walk meets them; paychecks the
// projection left out (late edge passed, unconfirmed) appear too, flagged,
// so nothing that explains the figure is silently missing. A one-off
// transaction dated after today appears too, on its date (migration 65).

import { addDaysISO } from "@/lib/date";
import type { AmountBasis } from "@/lib/amountBasis";
import type { ProjectedSource, SafeToSpendProjection } from "@/lib/safeToSpendProjection";

/** The list opens on this many days, today included; the rest sit behind an expander. */
export const UPCOMING_DEFAULT_DAYS = 14;

export type UpcomingOccurrence = {
  /**
   * recurringId + dueDate -- unique, since dueDate is the occurrence's own
   * date -- or "tx-" + transactionId for a one-off future transaction.
   */
  key: string;
  /** The schedule it comes from; null for a one-off future transaction. */
  recurringId: string | null;
  /** The one-off future transaction it is; null for a schedule's occurrence. */
  transactionId: string | null;
  name: string;
  direction: "income" | "bill";
  /** Dollars, positive. Income at its low estimate, as counted. */
  amount: number;
  /**
   * The day the projection counts it (income: late edge; bill: early edge,
   * never before today). For a missed paycheck, the due date it missed.
   */
  date: string;
  /** The occurrence's own due date. */
  dueDate: string;
  /**
   * "missed": a paycheck whose latest possible date has passed without
   * confirmation -- not counted. "expected": counted, but not in hand --
   * every income occurrence (income is never assumed to have arrived), and
   * any bill whose amount is an estimate. "known": a bill at a known amount.
   */
  status: "missed" | "expected" | "known";
  /** What amount rests on -- shown beside it. */
  basis: AmountBasis;
};

export type UpcomingOccurrences = {
  items: UpcomingOccurrence[];
  /** Last day shown before the expander -- today + UPCOMING_DEFAULT_DAYS - 1. */
  windowEnd: string;
  /** The projection's horizon -- where the expanded list ends. */
  horizonEnd: string;
};

// Within a day: missed first (they're past), then bills before income,
// matching the walk -- outflows leave before a same-day paycheck lands.
const RANK: Record<string, number> = { missed: 0, bill: 1, income: 2 };
const rank = (o: UpcomingOccurrence) => (o.status === "missed" ? RANK.missed : RANK[o.direction]);

/** A stable React key for a projected occurrence, schedule or one-off. */
export function occurrenceKey(o: ProjectedSource & { dueDate: string }): string {
  return o.transactionId !== null ? `tx-${o.transactionId}` : `${o.recurringId}-${o.dueDate}`;
}

export function buildUpcomingOccurrences(
  projection: Pick<SafeToSpendProjection, "incomes" | "obligations" | "unconfirmedIncome" | "horizonEnd">,
  today: string,
): UpcomingOccurrences {
  const items: UpcomingOccurrence[] = [
    ...projection.unconfirmedIncome.map(
      (u): UpcomingOccurrence => ({
        key: `${u.recurringId}-${u.dueDate}`,
        recurringId: u.recurringId,
        transactionId: null,
        name: u.name,
        direction: "income",
        amount: u.amount,
        date: u.dueDate,
        dueDate: u.dueDate,
        status: "missed",
        basis: u.basis,
      }),
    ),
    ...projection.incomes.map(
      (i): UpcomingOccurrence => ({
        key: occurrenceKey(i),
        recurringId: i.recurringId,
        transactionId: i.transactionId,
        name: i.name,
        direction: "income",
        amount: i.amount,
        date: i.date,
        dueDate: i.dueDate,
        status: "expected",
        basis: i.basis,
      }),
    ),
    ...projection.obligations.map(
      (o): UpcomingOccurrence => ({
        key: occurrenceKey(o),
        recurringId: o.recurringId,
        transactionId: o.transactionId,
        name: o.name,
        direction: "bill",
        amount: o.amount,
        date: o.date,
        dueDate: o.dueDate,
        status: o.isEstimate ? "expected" : "known",
        basis: o.basis,
      }),
    ),
  ];

  items.sort(
    (a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || rank(a) - rank(b) || a.name.localeCompare(b.name),
  );

  return {
    items,
    windowEnd: addDaysISO(today, UPCOMING_DEFAULT_DAYS - 1),
    horizonEnd: projection.horizonEnd,
  };
}
