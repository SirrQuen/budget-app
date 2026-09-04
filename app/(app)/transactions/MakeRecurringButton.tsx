"use client";

import { useEffect, useRef, useState } from "react";
import { RecurringForm, type RecurringPrefill } from "../recurring/RecurringForm";
import type { CategoryWithGroup } from "@/lib/db/categories";
import type { TransactionAccountOption } from "./AddTransactionForm";

// "Make this recurring" on an existing transaction (or transfer) row --
// most people's actual first recurring schedule: they've logged rent twice
// by hand and realize there's a better way. Opens RecurringForm in create
// mode, seeded from this row, with the schedule itself (Repeats/Next due
// date/Ends) left at its normal create-mode defaults -- a one-off entry
// implies no cadence, only the user knows what one to start.
//
// A native <dialog> (showModal) rather than FullFormOverlay's hand-rolled
// focus trap -- same approach ConfirmDialog already uses, and it gets
// focus containment and Escape-to-close for free.
export function MakeRecurringButton({
  prefill,
  incomeCategories,
  expenseCategories,
  accounts,
}: {
  prefill: RecurringPrefill;
  incomeCategories: CategoryWithGroup[];
  expenseCategories: CategoryWithGroup[];
  accounts: TransactionAccountOption[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center justify-end rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        Make recurring
      </button>

      <dialog
        ref={ref}
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        className="mx-auto my-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl bg-transparent p-0 text-ink backdrop:bg-scrim"
      >
        {/* Only mounted while open -- RecurringForm's uncontrolled
            defaultValues shouldn't hold a stale prefill across dialog
            reopens (e.g. this button clicked for two different rows in a
            row without the page re-rendering in between). */}
        {open ? (
          <RecurringForm
            prefill={prefill}
            incomeCategories={incomeCategories}
            expenseCategories={expenseCategories}
            accounts={accounts}
            onSuccess={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        ) : null}
      </dialog>
    </>
  );
}
