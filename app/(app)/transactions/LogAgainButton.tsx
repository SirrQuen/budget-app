"use client";

import { useMemo, useState } from "react";
import type { CategoryWithGroup } from "@/lib/db/categories";
import { FullFormOverlay } from "@/components/quick-add/FullFormOverlay";
import { SaveNote, useSaveNote } from "@/components/ui/SaveNote";
import { SaveToast, useSaveToast } from "@/components/ui/SaveToast";
import type { SavedSummary } from "@/lib/savedSummary";
import { SameBillQuestion } from "@/components/SameBillQuestion";
import type { SameBillPair } from "@/lib/sameBill";
import { logAgainPrefill, type LogAgainSource } from "@/lib/logAgain";
import type { GoalOption } from "@/lib/db/goals";
import type { SameMoneyPair } from "@/lib/goalLinks";
import { SameMoneyQuestion } from "@/components/SameMoneyQuestion";
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
  goals = [],
  className,
}: {
  source: LogAgainSource;
  /** Goals a transaction can be for -- the copied goal comes along only if listed. */
  goals?: GoalOption[];
  accounts: TransactionAccountOption[];
  incomeCategories: CategoryWithGroup[];
  expenseCategories: CategoryWithGroup[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [saveNote, showSaveNote] = useSaveNote();
  const [toast, showToast] = useSaveToast();
  // Set when reopened from the toast's own "Log again": the form starts from what was just logged.
  const [reopenFrom, setReopenFrom] = useState<SavedSummary | null>(null);
  const [sameBillPair, setSameBillPair] = useState<SameBillPair | null>(null);
  const [sameMoneyPair, setSameMoneyPair] = useState<SameMoneyPair | null>(null);

  // Opening reads the lists as they are now: what the pickers offer decides
  // which copied fields still apply. Active accounts and categories only.
  const prefill = useMemo(
    () =>
      logAgainPrefill(reopenFrom ? reopenFrom.source : source, {
        accountIds: new Set(accounts.filter((a) => a.is_active).map((a) => a.id)),
        incomeCategoryIds: new Set(incomeCategories.filter((c) => c.is_active).map((c) => c.id)),
        expenseCategoryIds: new Set(expenseCategories.filter((c) => c.is_active).map((c) => c.id)),
        goalIds: new Set(goals.map((g) => g.id)),
      }),
    [source, reopenFrom, accounts, incomeCategories, expenseCategories, goals],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setReopenFrom(null);
          setOpen(true);
        }}
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
          goals={goals}
          prefill={prefill}
          onClose={() => setOpen(false)}
          onSaved={(note, sameBill, sameMoney, saved) => {
            showToast(saved ?? null);
            showSaveNote(note);
            setSameBillPair(sameBill ?? null);
            setSameMoneyPair(sameMoney ?? null);
            setOpen(false);
          }}
        />
      ) : null}

      {/* text-left: this sits inside the list row's right-aligned actions
          cell, and position:fixed doesn't stop text-align inheriting. */}
      <div className="pointer-events-none fixed inset-x-4 bottom-24 z-50 flex flex-col items-center gap-2 text-left md:bottom-6">
        <SaveToast
          summary={toast}
          onLogAgain={(summary) => {
            showToast(null);
            setReopenFrom(summary);
            setOpen(true);
          }}
        />
        <SaveNote message={saveNote} />
        {sameBillPair ? (
          <SameBillQuestion
            key={sameBillPair.transactionId}
            pair={sameBillPair}
            onDismiss={() => setSameBillPair(null)}
            className="pointer-events-auto w-full max-w-md bg-surface shadow-lg"
          />
        ) : null}
        {sameMoneyPair ? (
          <SameMoneyQuestion
            key={sameMoneyPair.contributionId}
            pair={sameMoneyPair}
            onDone={() => setSameMoneyPair(null)}
            className="pointer-events-auto w-full max-w-md bg-surface shadow-lg"
          />
        ) : null}
      </div>
    </>
  );
}
