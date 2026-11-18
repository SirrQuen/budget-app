"use client";

import { useEffect, useRef, useState } from "react";
import { RecurringForm, type RecurringStart } from "../recurring/RecurringForm";
import type { CategoryWithGroup } from "@/lib/db/categories";
import type { GoalOption } from "@/lib/db/goals";
import type { TransactionAccountOption } from "../transactions/AddTransactionForm";
import { BILL_CHOICES, billCategoryId, type BillChoice } from "@/lib/billsPrompt";
import { CheckIcon } from "@/components/ui/icons";

// "Add your bills" (docs/Decide-and-Grow.md, G, addition): a chip per kind of
// bill, each opening the EXISTING recurring create form, prefilled with an
// expense and a name, and a category only when an existing active one fits
// (lib/billsPrompt.ts) -- otherwise the form's own picker asks. Saving is
// the form's own save. Shared by onboarding's step 3 and the dashboard card.
//
// After a save the chips come back, the added one with a quiet check: no
// toast, no leaves, no comment. The number it lowers rolls down on its own.

export type BillsFormLists = {
  incomeCategories: CategoryWithGroup[];
  expenseCategories: CategoryWithGroup[];
  accounts: TransactionAccountOption[];
  goals: GoalOption[];
  holidays: string[];
  /** Where a bill comes out of by default: the first checking or cash account. */
  defaultAccountId: string;
};

export function BillsPrompt({
  lists,
  added: addedFromData,
  stayOnPage = false,
  onAdded,
}: {
  lists: BillsFormLists;
  /** Choices that already have a schedule (addedBillKeys), from the server. */
  added: string[];
  /** Onboarding's step 3: save without re-rendering the page. */
  stayOnPage?: boolean;
  onAdded?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<BillChoice | null>(null);
  const [addedHere, setAddedHere] = useState<string[]>([]);
  const added = new Set([...addedFromData, ...addedHere]);
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastChip = useRef<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    // Back on the chips: focus returns to the one that was opened.
    if (!open && lastChip.current) chipRefs.current.get(lastChip.current)?.focus();
  }, [open]);

  const activeExpense = lists.expenseCategories
    .filter((c) => c.is_active)
    .map((c) => ({ id: c.id, name: c.category_name }));

  function start(choice: BillChoice): RecurringStart {
    return {
      description: choice.description,
      kind: "Expense",
      categoryid: billCategoryId(choice, activeExpense),
      accountid: lists.defaultAccountId,
      to_accountid: null,
    };
  }

  return (
    <>
      <ul className="flex flex-wrap gap-2" aria-label="Bills to add">
        {BILL_CHOICES.map((choice) => {
          const isAdded = added.has(choice.key);
          return (
            <li key={choice.key}>
              <button
                type="button"
                ref={(el) => {
                  if (el) chipRefs.current.set(choice.key, el);
                  else chipRefs.current.delete(choice.key);
                }}
                onClick={() => {
                  lastChip.current = choice.key;
                  setOpen(choice);
                }}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-field-border px-4 text-sm text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                {isAdded ? <CheckIcon className="h-3.5 w-3.5 text-ink" aria-hidden="true" /> : null}
                {choice.label}
                {isAdded ? <span className="sr-only">, added</span> : null}
              </button>
            </li>
          );
        })}
      </ul>

      <dialog
        ref={ref}
        aria-label={open ? `Add ${open.label.toLowerCase()}` : undefined}
        onCancel={(e) => {
          e.preventDefault();
          setOpen(null);
        }}
        onClose={() => setOpen(null)}
        className="mx-auto my-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl bg-transparent p-0 text-ink backdrop:bg-scrim"
      >
        {/* Mounted only while open, so each choice starts fresh. */}
        {open ? (
          <RecurringForm
            key={open.key}
            start={start(open)}
            stayOnPage={stayOnPage}
            incomeCategories={lists.incomeCategories}
            expenseCategories={lists.expenseCategories}
            accounts={lists.accounts}
            goals={lists.goals}
            holidays={lists.holidays}
            onSuccess={() => {
              const key = open.key;
              setAddedHere((keys) => (keys.includes(key) ? keys : [...keys, key]));
              setOpen(null);
              onAdded?.();
            }}
            onCancel={() => setOpen(null)}
          />
        ) : null}
      </dialog>
    </>
  );
}
