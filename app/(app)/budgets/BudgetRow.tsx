"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { BudgetForm, type EditableBudget } from "./BudgetForm";
import { deleteBudgetAction } from "@/lib/actions/budgets";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Meter } from "@/components/ui/Meter";
import { Celebration } from "@/components/ui/Celebration";
import { WarningIcon, TrashIcon } from "@/components/ui/icons";
import { formatCurrency } from "@/lib/format";
import type { Database } from "@/lib/database.types";
import type { CategoryWithGroup } from "@/lib/db/categories";

export type BudgetProgressRow = Database["public"]["Views"]["v_budget_vs_actual"]["Row"];

// True once the month after monthISO has started -- the viewed month is
// fully in the books, not still accumulating spend.
function isPastMonth(monthISO: string): boolean {
  const [y, m] = monthISO.split("-").map(Number);
  const nextMonthStart = new Date(y, m, 1);
  return new Date() >= nextMonthStart;
}

export function BudgetRow({
  budget,
  categories,
}: {
  // Callers only ever pass rows with budget_id set (see the filter in
  // page.tsx) -- this is still the view's row type since the view itself
  // leaves every column nullable.
  budget: BudgetProgressRow;
  categories: CategoryWithGroup[];
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [isDeleting, startDelete] = useTransition();
  const [showFinishedCelebration, setShowFinishedCelebration] = useState(false);
  const finishedCelebrationTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const celebratedRef = useRef(false);

  // A finished-under-budget month is a one-time milestone, not a banner that
  // reappears every time this page is revisited -- localStorage remembers
  // which budgets already got their moment, scoped to this budget row's id.
  // celebratedRef is what actually gates the setState calls below (rather
  // than a plain prop check) -- effects that derive their setState purely
  // from props/an external store like localStorage read cascading-render
  // risk into every render, where a ref-guarded "already handled" check
  // reads as the one-shot side effect it actually is.
  useEffect(() => {
    const budgetId = budget.budget_id;
    const month = budget.budget_month;
    const alreadyCelebrated =
      celebratedRef.current || (budgetId !== null && localStorage.getItem(`celebrated-budget-${budgetId}`) !== null);
    const eligible =
      !alreadyCelebrated &&
      budgetId !== null &&
      month !== null &&
      !budget.is_over_budget &&
      (budget.actual_spend ?? 0) > 0 &&
      isPastMonth(month);

    if (eligible) {
      celebratedRef.current = true;
      localStorage.setItem(`celebrated-budget-${budgetId}`, "1");
      setShowFinishedCelebration(true);
      finishedCelebrationTimeout.current = setTimeout(() => setShowFinishedCelebration(false), 1800);
    }
  }, [budget.budget_id, budget.budget_month, budget.is_over_budget, budget.actual_spend]);

  useEffect(() => () => clearTimeout(finishedCelebrationTimeout.current), []);

  function handleDelete() {
    startDelete(async () => {
      const result = await deleteBudgetAction(budget.budget_id!);
      if (result?.error) {
        setDeleteError(result.error);
        return;
      }
      setConfirmingDelete(false);
    });
  }

  if (editing) {
    const editable: EditableBudget = {
      id: budget.budget_id!,
      categoryid: budget.category_id!,
      budget_month: budget.budget_month!,
      budget_amount: budget.budget_amount ?? 0,
    };
    return (
      <li className="p-4">
        <BudgetForm
          budget={editable}
          categories={categories}
          month={budget.budget_month!}
          onSuccess={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  const budgeted = budget.budget_amount ?? 0;
  const spent = budget.actual_spend ?? 0;
  const remaining = budget.remaining ?? 0;
  const pctUsed = budget.pct_used ?? 0;
  const isOver = budget.is_over_budget ?? false;

  return (
    <li className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-center gap-3">
        <CategoryIcon icon={budget.category_icon} className="h-4 w-4 shrink-0 text-ink-secondary" />
        <span className="flex-1 text-sm font-medium text-ink">{budget.category_name}</span>
        {deleteError ? <span className="shrink-0 text-sm text-critical">{deleteError}</span> : null}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 text-sm font-medium text-ink-secondary hover:text-ink"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="shrink-0 text-sm font-medium text-ink-secondary hover:text-ink"
        >
          Delete
        </button>
      </div>

      <Meter
        value={pctUsed}
        max={100}
        warningAt={80}
        criticalAt={100}
        label={budget.category_name ?? undefined}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-ink-secondary">
          {formatCurrency(spent)} of {formatCurrency(budgeted)}
        </span>
        {isOver ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-critical">
            <WarningIcon className="h-4 w-4" aria-hidden="true" />
            {formatCurrency(Math.abs(remaining))} over — worth a look
          </span>
        ) : (
          <span className="text-ink-secondary">{formatCurrency(remaining)} left this month</span>
        )}
      </div>

      <Celebration
        show={showFinishedCelebration}
        message={`${formatCurrency(remaining)} under budget in ${budget.category_name}`}
        icon="✦"
      />

      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete budget for "${budget.category_name}"?`}
        description="This removes the monthly budget for this category. Past transactions aren't affected."
        confirmLabel={isDeleting ? "Deleting…" : "Delete"}
        confirmIcon={<TrashIcon className="h-4 w-4" aria-hidden="true" />}
        cancelLabel="Cancel"
        tone="critical"
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </li>
  );
}
