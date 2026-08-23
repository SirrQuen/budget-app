import type { BudgetProgressRow } from "@/lib/db/budgets";

const LOOKBACK_MONTHS = 3;
const OVER_THRESHOLD = 2;

export type ChronicOverBudget = {
  overCount: number;
  monthsConsidered: number;
  /** Average actual spend over the lookback window, rounded to a clean $5 step. */
  suggestedAmount: number;
};

// Looks at the months immediately before the one being viewed, for this
// category only -- never the in-progress month itself, which hasn't
// finished accruing spend and would be a premature read either way. Needs
// a full lookback window of prior *budgeted* months before saying anything,
// so a category with only one or two months of history never gets flagged.
export function getChronicOverBudgetInsight(
  categoryHistory: BudgetProgressRow[],
  currentMonth: string,
): ChronicOverBudget | null {
  const priorMonths = categoryHistory
    .filter((row) => row.budget_id !== null && row.budget_month !== null && row.budget_month < currentMonth)
    .sort((a, b) => b.budget_month!.localeCompare(a.budget_month!))
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
