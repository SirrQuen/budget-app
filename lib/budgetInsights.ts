import type { MonthBudgetRow } from "@/lib/db/budgets";

export const LOOKBACK_MONTHS = 3;
const OVER_THRESHOLD = 2;

export type ChronicOverBudget = {
  overCount: number;
  monthsConsidered: number;
  /** Average actual spend over the lookback window, rounded to a clean $5 step. */
  suggestedAmount: number;
};

type HistoryRow = Pick<MonthBudgetRow, "budget_month" | "is_over_budget" | "actual_spend">;

// Looks at the months immediately before the one being viewed, for this
// category only -- never the in-progress month itself, which hasn't
// finished accruing spend and would be a premature read either way. Needs
// a full lookback window of prior budgeted months before saying anything,
// so a category with only one or two months of history never gets flagged.
//
// "Budgeted" includes CARRIED months (budget_progress_for_month, migration
// 63). A budget amount is standing, so most months carry rather than having
// a row of their own; counting only explicit rows, this would almost never
// fire. A month after "Stop budgeting" isn't budgeted and isn't counted.
export function getChronicOverBudgetInsight(
  categoryHistory: HistoryRow[],
  currentMonth: string,
): ChronicOverBudget | null {
  const priorMonths = categoryHistory
    .filter((row) => row.budget_month < currentMonth)
    .sort((a, b) => b.budget_month.localeCompare(a.budget_month))
    .slice(0, LOOKBACK_MONTHS);

  if (priorMonths.length < LOOKBACK_MONTHS) {
    return null;
  }

  const overCount = priorMonths.filter((row) => row.is_over_budget).length;
  if (overCount < OVER_THRESHOLD) {
    return null;
  }

  const avgSpend = priorMonths.reduce((sum, row) => sum + (row.actual_spend ?? 0), 0) / priorMonths.length;
  const suggestedAmount = Math.max(5, Math.round(avgSpend / 5) * 5);

  return { overCount, monthsConsidered: priorMonths.length, suggestedAmount };
}
