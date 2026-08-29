"use client";

import { useEffect } from "react";
import {
  AddTransactionForm,
  type AddTransactionPrefill,
  type TransactionAccountOption,
} from "@/app/(app)/transactions/AddTransactionForm";
import type { CategoryWithGroup } from "@/lib/db/categories";

// Quick-add's escape hatch -- the same AddTransactionForm the /transactions
// page uses, in "embedded" mode (always expanded, Close/save wired to this
// overlay instead of the page-inline collapse), reachable from any page.
export function FullFormOverlay({
  accounts,
  incomeCategories,
  expenseCategories,
  prefill,
  onClose,
  onSaved,
}: {
  accounts: TransactionAccountOption[];
  incomeCategories: CategoryWithGroup[];
  expenseCategories: CategoryWithGroup[];
  prefill?: AddTransactionPrefill;
  onClose: () => void;
  onSaved: () => void;
}) {
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-scrim px-4 py-8 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg motion-safe:animate-[celebrate-pop_150ms_ease-out]">
        <AddTransactionForm
          embedded
          prefill={prefill}
          accounts={accounts}
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
          onClose={onClose}
          onSaved={onSaved}
        />
      </div>
    </div>
  );
}
