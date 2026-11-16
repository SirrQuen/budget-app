"use client";

import { useMemo, useState } from "react";
import type { CategoryWithGroup } from "@/lib/db/categories";
import { FullFormOverlay } from "@/components/quick-add/FullFormOverlay";
import { SaveNote, useSaveNote } from "@/components/ui/SaveNote";
import { SameBillQuestion } from "@/components/SameBillQuestion";
import type { SameBillPair } from "@/lib/sameBill";
import { logAgainPrefill, type LogAgainSource } from "@/lib/logAgain";
import type { TransactionAccountOption } from "./AddTransactionForm";

// "Log again": opens the add form pre-filled from a past transaction
// (lib/logAgain.ts). It only opens a form -- Save is always its own,
// deliberate tap, and the save is the ordinary new-transaction write.
// Self-contained (its own overlay) so it works wherever a transaction is
// shown, whether or not the quick-add bar is on that screen.
export function LogAgainButton({
  source,
  accounts,
  incomeCategories,
  expenseCategories,
  className,
}: {
  source: LogAgainSource;
  accounts: TransactionAccountOption[];
  incomeCategories: CategoryWithGroup[];
  expenseCategories: CategoryWithGroup[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [saveNote, showSaveNote] = useSaveNote();
  const [sameBillPair, setSameBillPair] = useState<SameBillPair | null>(null);

  // Opening reads the lists as they are now: what the pickers offer decides
  // which copied fields still apply. Active accounts and categories only.
  const prefill = useMemo(
    () =>
      logAgainPrefill(source, {
        accountIds: new Set(accounts.filter((a) => a.is_active).map((a) => a.id)),
        incomeCategoryIds: new Set(incomeCategories.filter((c) => c.is_active).map((c) => c.id)),
        expenseCategoryIds: new Set(expenseCategories.filter((c) => c.is_active).map((c) => c.id)),
      }),
    [source, accounts, incomeCategories, expenseCategories],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Log again: ${source.description}`}
        className={
          className ??
          "inline-flex min-h-11 items-center justify-end rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        }
      >
        Log again
      </button>

      {open ? (
        <FullFormOverlay
          accounts={accounts}
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
          prefill={prefill}
          onClose={() => setOpen(false)}
          onSaved={(note, sameBill) => {
            showSaveNote(note);
            setSameBillPair(sameBill ?? null);
            setOpen(false);
          }}
        />
      ) : null}

      <div className="pointer-events-none fixed inset-x-4 bottom-24 z-50 flex flex-col items-center gap-2 md:bottom-6">
        <SaveNote message={saveNote} />
        {sameBillPair ? (
          <SameBillQuestion
            key={sameBillPair.transactionId}
            pair={sameBillPair}
            onDismiss={() => setSameBillPair(null)}
            className="pointer-events-auto w-full max-w-md bg-surface shadow-lg"
          />
        ) : null}
      </div>
    </>
  );
}
