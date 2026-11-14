"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { TransferIcon } from "@/components/ui/icons";
import { Amount } from "@/components/ui/Amount";
import { formatDateShort } from "@/lib/format";
import type { OverdueOccurrence } from "@/lib/safeToSpendProjection";
import {
  UPCOMING_DEFAULT_DAYS,
  type UpcomingOccurrence,
  type UpcomingOccurrences,
} from "@/lib/upcomingOccurrences";
import { ConfirmVariableAmountSheet, type VariableAmountTarget } from "../recurring/ConfirmVariableAmountSheet";
import { INLINE_ACTION, UnconfirmedIncomeNote } from "./UnconfirmedIncomeNote";
import { AmountBasisTag } from "@/components/AmountBasisTag";
import { SameBillQuestion } from "@/components/SameBillQuestion";
import type { SameBillPair } from "@/lib/sameBill";

/** Per-schedule display details the projection doesn't carry. */
export type UpcomingScheduleMeta = {
  categoryIcon: string | null;
  isTransfer: boolean;
  /**
   * A card payment's "enter the statement amount", when it has one -- a
   * revision of the expectation, not a confirmation (those live in the
   * confirmation queue). It belongs to exactly one occurrence, the
   * schedule's next_due_date, so it's matched by dueDate, never shown on
   * every row.
   */
  confirm: { kind: "card"; dueDate: string; target: VariableAmountTarget } | null;
};

// Every occurrence the safe-to-spend projection counts, bills and income
// mixed by date, so this list explains the number beside it rather than
// contradicting it. Opens on the next UPCOMING_DEFAULT_DAYS days -- labelled
// as such -- with the rest of the horizon behind an expander.
export function UpcomingList({
  data,
  unconfirmedIncome,
  schedules,
  futureTransactions,
  sameBillPairs = [],
}: {
  data: UpcomingOccurrences;
  /** The projection's missed paychecks -- what a "missed" row describes. */
  unconfirmedIncome: OverdueOccurrence[];
  schedules: Record<string, UpcomingScheduleMeta>;
  /** Per one-off future transaction, by id -- never a confirm action. */
  futureTransactions: Record<string, UpcomingScheduleMeta>;
  /**
   * A schedule's occurrence and an entry for the same bill (lib/sameBill.ts):
   * shown together, once, with the question -- never as two unrelated rows.
   */
  sameBillPairs?: SameBillPair[];
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  const inWindow = data.items.filter((i) => i.date <= data.windowEnd);
  const later = data.items.length - inWindow.length;
  const shown = expanded ? data.items : inWindow;

  // Either half of a pair, by the item it is: a schedule's occurrence by
  // schedule and due date, an entry by its id.
  const pairOf = (item: UpcomingOccurrence): SameBillPair | undefined =>
    sameBillPairs.find((p) =>
      item.recurringId !== null
        ? p.recurringId === item.recurringId && p.dueDate === item.dueDate
        : p.transactionId === item.transactionId,
    );
  const metaOf = (item: UpcomingOccurrence) =>
    item.recurringId !== null
      ? schedules[item.recurringId]
      : item.transactionId !== null
        ? futureTransactions[item.transactionId]
        : undefined;
  // The pair sits where its first half would; the second half is skipped.
  const placed = new Set<SameBillPair>();
  const rows = shown.flatMap((item) => {
    if (item.status === "missed") {
      return [<MissedRow key={item.key} item={item} unconfirmedIncome={unconfirmedIncome} />];
    }
    const pair = pairOf(item);
    if (pair === undefined) {
      return [<OccurrenceRow key={item.key} item={item} meta={metaOf(item)} />];
    }
    if (placed.has(pair)) return [];
    placed.add(pair);
    const halves = data.items.filter((i) => i.status !== "missed" && pairOf(i) === pair);
    return [
      <li key={`pair-${pair.recurringId}-${pair.transactionId}`} className="flex flex-col gap-1 py-2.5 text-sm">
        {halves.map((half) => (
          <OccurrenceBody key={half.key} item={half} meta={metaOf(half)} />
        ))}
        <SameBillQuestion pair={pair} className="mt-1" />
      </li>,
    ];
  });

  return (
    <section className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-ink-secondary">Upcoming</h2>
          <p className="text-xs text-ink-muted">
            {expanded
              ? `Through ${formatDateShort(data.horizonEnd)}`
              : `Next ${UPCOMING_DEFAULT_DAYS} days · through ${formatDateShort(data.windowEnd)}`}
          </p>
        </div>
        <Link
          href="/transactions"
          className="text-xs text-ink-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Transactions
        </Link>
      </div>

      <div id={listId}>
        {shown.length === 0 ? (
          <p className="py-2.5 text-sm text-ink-secondary">
            Nothing due in the next {UPCOMING_DEFAULT_DAYS} days.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">{rows}</ul>
        )}
      </div>

      {later > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((e) => !e)}
          className={`mt-2 ${INLINE_ACTION}`}
        >
          {expanded
            ? `Show the next ${UPCOMING_DEFAULT_DAYS} days only`
            : `+ ${later} more through ${formatDateShort(data.horizonEnd)}`}
        </button>
      ) : null}
    </section>
  );
}

function MissedRow({
  item,
  unconfirmedIncome,
}: {
  item: UpcomingOccurrence;
  unconfirmedIncome: OverdueOccurrence[];
}) {
  const missed = unconfirmedIncome.find((u) => u.recurringId === item.recurringId && u.dueDate === item.dueDate);
  if (!missed) return null;
  return (
    <li className="py-2.5 text-xs text-ink-secondary">
      <UnconfirmedIncomeNote item={missed} />
    </li>
  );
}

function OccurrenceRow({ item, meta }: { item: UpcomingOccurrence; meta: UpcomingScheduleMeta | undefined }) {
  return (
    <li className="flex flex-col gap-1 py-2.5 text-sm">
      <OccurrenceBody item={item} meta={meta} />
    </li>
  );
}

function OccurrenceBody({ item, meta }: { item: UpcomingOccurrence; meta: UpcomingScheduleMeta | undefined }) {
  const confirm = meta?.confirm && meta.confirm.dueDate === item.dueDate ? meta.confirm : null;

  return (
    <>
      <div className="flex items-center gap-3">
        {meta?.isTransfer ? (
          <TransferIcon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
        ) : (
          <CategoryIcon icon={meta?.categoryIcon ?? null} className="h-4 w-4 shrink-0 text-ink-muted" />
        )}
        {/* Wraps below sm: beside the date and amount, a 320px viewport
            cut the name to ~70px. */}
        <span className="min-w-0 flex-1 break-words text-ink sm:truncate">
          {/* A one-off the person entered: no confirmation on its date --
              if it didn't happen, they edit or delete it. */}
          {item.transactionId !== null ? (
            <Link
              href={`/transactions/${item.transactionId}/edit`}
              className="rounded underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              {item.name}
            </Link>
          ) : (
            item.name
          )}
          {/* Quiet on purpose: no colour, no icon -- what the amount rests on. */}
          <AmountBasisTag basis={item.basis} className="ml-1.5" />
        </span>
        <span className="shrink-0 tabular-nums text-ink-secondary">{formatDateShort(item.date)}</span>
        <Amount
          amount={item.amount}
          type={item.direction === "income" ? "Income" : "Expense"}
          column
          className="shrink-0"
        />
      </div>

      {confirm ? (
        <div className="flex justify-end pl-7">
          <ConfirmVariableAmountSheet
            target={confirm.target}
            trigger={(open) => (
              <button type="button" onClick={open} className={INLINE_ACTION}>
                Enter statement amount
              </button>
            )}
          />
        </div>
      ) : null}
    </>
  );
}
