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
import { ConfirmIncomeSheet, type IncomeConfirmTarget } from "../recurring/ConfirmIncomeSheet";
import { INLINE_ACTION, UnconfirmedIncomeNote } from "./UnconfirmedIncomeNote";

/** Per-schedule display details the projection doesn't carry. */
export type UpcomingScheduleMeta = {
  categoryIcon: string | null;
  isTransfer: boolean;
  /**
   * The Confirm action, when this schedule has one. It belongs to exactly
   * one occurrence -- the schedule's next_due_date, the one confirming acts
   * on -- so it's matched by dueDate, never shown on every row.
   */
  confirm:
    | { kind: "income"; dueDate: string; target: IncomeConfirmTarget }
    | { kind: "card"; dueDate: string; target: VariableAmountTarget }
    | null;
};

// Every occurrence the safe-to-spend projection counts, bills and income
// mixed by date, so this list explains the number beside it rather than
// contradicting it. Opens on the next UPCOMING_DEFAULT_DAYS days -- labelled
// as such -- with the rest of the horizon behind an expander.
export function UpcomingList({
  data,
  unconfirmedIncome,
  schedules,
}: {
  data: UpcomingOccurrences;
  /** The projection's missed paychecks -- what a "missed" row describes. */
  unconfirmedIncome: OverdueOccurrence[];
  schedules: Record<string, UpcomingScheduleMeta>;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  const inWindow = data.items.filter((i) => i.date <= data.windowEnd);
  const later = data.items.length - inWindow.length;
  const shown = expanded ? data.items : inWindow;

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
          <ul className="divide-y divide-hairline">
            {shown.map((item) =>
              item.status === "missed" ? (
                <MissedRow key={item.key} item={item} unconfirmedIncome={unconfirmedIncome} />
              ) : (
                <OccurrenceRow key={item.key} item={item} meta={schedules[item.recurringId]} />
              ),
            )}
          </ul>
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
  const confirm = meta?.confirm && meta.confirm.dueDate === item.dueDate ? meta.confirm : null;

  return (
    <li className="flex flex-col gap-1 py-2.5 text-sm">
      <div className="flex items-center gap-3">
        {meta?.isTransfer ? (
          <TransferIcon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
        ) : (
          <CategoryIcon icon={meta?.categoryIcon ?? null} className="h-4 w-4 shrink-0 text-ink-muted" />
        )}
        <span className="min-w-0 flex-1 truncate text-ink">
          {item.name}
          {/* Quiet on purpose: no colour, no icon. A known bill carries nothing. */}
          {item.status === "expected" ? <span className="ml-1.5 text-xs text-ink-muted">expected</span> : null}
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
          {confirm.kind === "income" ? (
            <ConfirmIncomeSheet
              target={confirm.target}
              trigger={(open) => (
                <button type="button" onClick={open} className={INLINE_ACTION}>
                  Confirm
                </button>
              )}
            />
          ) : (
            <ConfirmVariableAmountSheet
              target={confirm.target}
              trigger={(open) => (
                <button type="button" onClick={open} className={INLINE_ACTION}>
                  Confirm
                </button>
              )}
            />
          )}
        </div>
      ) : null}
    </li>
  );
}
