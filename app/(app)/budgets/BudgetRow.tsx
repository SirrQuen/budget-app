"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { BudgetForm, type EditableBudget } from "./BudgetForm";
import { stopBudgetingAction } from "@/lib/actions/budgets";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Meter } from "@/components/ui/Meter";
import { Celebration } from "@/components/ui/Celebration";
import { formatCurrency } from "@/lib/format";
import type { MonthBudgetRow } from "@/lib/db/budgets";
import { carriedFromLabel, formatMonthName } from "@/lib/budgetMonth";
import type { ChronicOverBudget } from "@/lib/budgetInsights";
import type { CategoryWithGroup } from "@/lib/db/categories";
import { callAction } from "@/components/useActionForm";
import { buildListHref, monthRange } from "@/lib/transactionFilters";

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
  // One category's budget for the viewed month: its own row (budget_id
  // set), or carried from an earlier month (carried_from set, budget_id
  // null -- no row exists for this month until the amount is edited).
  budget: MonthBudgetRow;
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
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [stopError, setStopError] = useState<string>();
  const [isStopping, startStop] = useTransition();
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

  // "Stop budgeting" writes a tombstone for this month (migration 63):
  // the category is unbudgeted from here on, earlier months keep their
  // amounts. Never a delete -- that would bring an earlier amount back.
  function handleStop() {
    startStop(async () => {
      const result = await callAction(() => stopBudgetingAction(budget.category_id, budget.budget_month));
      if (result?.error) {
        setStopError(result.error);
        return;
      }
      setConfirmingStop(false);
    });
  }

  function closeForm() {
    setEditing(false);
    setAdjustAmount(null);
  }

  if (editing) {
    const editable: EditableBudget = {
      categoryid: budget.category_id,
      category_name: budget.category_name,
      budget_month: budget.budget_month,
      budget_amount: adjustAmount ?? budget.budget_amount ?? 0,
      carriedFrom: budget.carried_from,
    };
    return (
      <li className="p-4">
        <BudgetForm
          budget={editable}
          categories={categories}
          month={budget.budget_month}
          onSuccess={closeForm}
          onCancel={closeForm}
        />
      </li>
    );
  }

  const budgeted = budget.budget_amount ?? 0;
  const spent = budget.actual_spend ?? 0;
  // "Every number is a door": the spent figure opens the rows behind it --
  // this category, this month.
  const spentHref = buildListHref("/transactions", {
    categoryid: budget.category_id,
    ...monthRange(budget.budget_month),
  });
  const remaining = budget.remaining ?? 0;
  const isOver = budget.is_over_budget ?? false;
  // A $0 budget is a budget ("not spending on this"), never "unbudgeted".
  // It has no percentage; the meter reads empty until something is spent,
  // then full.
  const isZero = budgeted === 0;
  const pctUsed = isZero ? (spent > 0 ? 100 : 0) : (budget.pct_used ?? 0);

  return (
    <li className="flex flex-col gap-3 px-4 py-4 transition-colors duration-150 hover:bg-surface-raised">
      {/* Below sm the actions drop onto their own line so "Edit" / "Stop budgeting"
          stop competing with the category name for width, and each gets a
          44px tap target; inline from sm up. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex min-w-0 items-center gap-3 sm:flex-1">
          <CategoryIcon icon={budget.category_icon} className="h-4 w-4 shrink-0 text-ink-secondary" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
            {budget.category_name}
            {/* Says where an untouched amount came from, so it doesn't read
                as something set for this month and forgotten. */}
            {budget.carried_from ? (
              <span className="ml-2 text-xs font-normal text-ink-muted">
                {carriedFromLabel(budget.carried_from, budget.budget_month)}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 text-base font-semibold tabular-nums text-ink">
            {isZero ? "$0" : `${Math.round(pctUsed)}%`}
          </span>
        </div>
        <div className="-mx-2 flex shrink-0 items-center gap-1 sm:mx-0 sm:gap-3">
          {stopError ? <span className="px-2 text-sm text-critical sm:px-0">{stopError}</span> : null}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex min-h-11 items-center rounded px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:px-0"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setConfirmingStop(true)}
            className="inline-flex min-h-11 items-center rounded px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:px-0"
          >
            Stop budgeting
          </button>
        </div>
      </div>

      <Meter value={pctUsed} ariaLabel={`${budget.category_name ?? "Category"} budget used`} />

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-secondary">
        {isZero ? (
          <span>
            {spent > 0 ? (
              <Link href={spentHref} className="rounded underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
                {formatCurrency(spent)} spent against a $0 budget this month
              </Link>
            ) : (
              "$0 budgeted, nothing spent this month"
            )}
          </span>
        ) : (
          <>
            <span>
              <Link href={spentHref} className="rounded underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
                {formatCurrency(spent)}
              </Link>{" "}
              of {formatCurrency(budgeted)}
            </span>
            <span>
              {isOver
                ? `${formatCurrency(Math.abs(remaining))} over this month`
                : `${formatCurrency(remaining)} left this month`}
            </span>
          </>
        )}
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

      {/* Not destructive -- earlier months keep their amounts, and adding a
          budget again starts it again -- so the default tone, not red. */}
      <ConfirmDialog
        open={confirmingStop}
        title={`Stop budgeting ${budget.category_name} from ${formatMonthName(budget.budget_month)}?`}
        description={`${budget.category_name} won't have a budget from ${formatMonthName(budget.budget_month)} on. Earlier months keep theirs, and you can add one again any time.`}
        confirmLabel={isStopping ? "Stopping…" : "Stop budgeting"}
        cancelLabel="Cancel"
        onConfirm={handleStop}
        onCancel={() => setConfirmingStop(false)}
      />
    </li>
  );
}
