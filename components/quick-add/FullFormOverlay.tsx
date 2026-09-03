"use client";

import { useEffect, useId, useRef } from "react";
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
  const panelRef = useRef<HTMLDivElement>(null);
  const labelId = useId();

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Focus trap: Tab off either end of the panel wraps to the other.
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [onClose]);

  // Move focus into the panel on open, and hand it back to whatever opened
  // the overlay (the quick-add "Full form" button or FAB) on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const firstField = panelRef.current?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
    );
    firstField?.focus();
    return () => opener?.focus?.();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-scrim px-4 py-8 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        className="w-full max-w-lg motion-safe:animate-[celebrate-pop_150ms_ease-out]"
      >
        <AddTransactionForm
          embedded
          headingId={labelId}
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
