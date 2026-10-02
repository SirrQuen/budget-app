"use client";

import type { OverdueOccurrence } from "@/lib/safeToSpendProjection";
import { formatDateShort } from "@/lib/format";
import { ConfirmIncomeSheet } from "../recurring/ConfirmIncomeSheet";

export const INLINE_ACTION =
  "rounded text-xs font-medium text-ink underline underline-offset-2 transition-colors duration-150 hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50";

// A paycheck the projection left out because it was never confirmed. The
// maths is right to drop it; the user still needs to see why the figure is
// lower than they expect, and a way to fix it in place. One wording, shared
// by the hero's breakdown and the Upcoming list, so the two always agree.
//
// The schedule's name stands alone -- never name + "paycheck": a schedule
// called "Paycheck" would read "Paycheck paycheck".
export function UnconfirmedIncomeNote({ item }: { item: OverdueOccurrence }) {
  return (
    <>
      Your {formatDateShort(item.dueDate)} {item.name} hasn&apos;t been confirmed, so it isn&apos;t
      counted.{" "}
      <ConfirmIncomeSheet
        target={{
          id: item.recurringId,
          name: item.name,
          estimatedAmount: item.amount,
          isEstimate: item.isEstimate,
          dueDate: item.dueDate,
        }}
        trigger={(open) => (
          <button type="button" onClick={open} className={INLINE_ACTION}>
            Confirm it
          </button>
        )}
      />
    </>
  );
}
