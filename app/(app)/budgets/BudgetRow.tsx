"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { BudgetForm, type EditableBudget } from "./BudgetForm";
import { deleteBudgetAction } from "@/lib/actions/budgets";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Meter } from "@/components/ui/Meter";
import { Celebration } from "@/components/ui/Celebration";
import { TrashIcon } from "@/components/ui/icons";
import { formatCurrency } from "@/lib/format";
import type { BudgetProgressRow } from "@/lib/db/budgets";
import type { ChronicOverBudget } from "@/lib/budgetInsights";
import type { CategoryWithGroup } from "@/lib/db/categories";

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
  insight,
}: {
  // Callers only ever pass rows with budget_id set (see the filter in
  // page.tsx) -- this is still the view's row type since the view itself
  // leaves every column nullable.
  budget: BudgetProgressRow;
  categories: CategoryWithGroup[];
  /** Non-null when this category has run over budget in most of the last
   * few months -- see getChronicOverBudgetInsight. */
  insight: ChronicOverBudget | null;
}) {
  const [editing, setEditing] = useState(false);
  // Set only when editing was opened via "Adjust budget" -- overrides the
  // form's default of the current budgeted amount with the insight's
  // suggestion, still just a starting point the user can change or ignore.
  const [adjustAmount, setAdjustAmount] = useState<number | null>(null);
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

  function closeForm() {
    setEditing(false);
    setAdjustAmount(null);
  }

  if (editing) {
    const editable: EditableBudget = {
      id: budget.budget_id!,
      categoryid: budget.category_id!,
      budget_month: budget.budget_month!,
      budget_amount: adjustAmount ?? budget.budget_amount ?? 0,
    };
    return (
      <li className="p-4">
        <BudgetForm
          budget={editable}
          categories={categories}
          month={budget.budget_month!}
          onSuccess={closeForm}
          onCancel={closeForm}
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
    <li className="flex flex-col gap-3 px-4 py-4 transition-colors duration-150 hover:bg-surface-raised">
      {/* Below sm the actions drop onto their own line so "Edit" / "Delete"
          stop competing with the category name for width, and each gets a
          44px tap target; inline from sm up. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex min-w-0 items-center gap-3 sm:flex-1">
          <CategoryIcon icon={budget.category_icon} className="h-4 w-4 shrink-0 text-ink-secondary" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{budget.category_name}</span>
          <span className="shrink-0 text-base font-semibold tabular-nums text-ink">{Math.round(pctUsed)}%</span>
        </div>
        <div className="-mx-2 flex shrink-0 items-center gap-1 sm:mx-0 sm:gap-3">
          {deleteError ? <span className="px-2 text-sm text-critical sm:px-0">{deleteError}</span> : null}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex min-h-11 items-center rounded px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:px-0"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="inline-flex min-h-11 items-center rounded px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:px-0"
          >
            Delete
          </button>
        </div>
      </div>

      <Meter value={pctUsed} ariaLabel={`${budget.category_name ?? "Category"} budget used`} />

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-secondary">
        <span>
          {formatCurrency(spent)} of {formatCurrency(budgeted)}
        </span>
        <span>
          {isOver
            ? `${formatCurrency(Math.abs(remaining))} over this month`
            : `${formatCurrency(remaining)} left this month`}
        </span>
      </div>

      {insight ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline bg-surface-raised px-3 py-2 text-sm">
          <span className="text-ink-secondary">
            Over budget {insight.overCount} of the last {insight.monthsConsidered} months, averaging{" "}
            {formatCurrency(insight.suggestedAmount)}.
          </span>
          <button
            type="button"
            onClick={() => {
              setAdjustAmount(insight.suggestedAmount);
              setEditing(true);
            }}
            className="shrink-0 rounded text-sm font-medium text-action transition-colors duration-150 hover:text-action-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          >
            Adjust to {formatCurrency(insight.suggestedAmount)}
          </button>
        </div>
      ) : null}

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
