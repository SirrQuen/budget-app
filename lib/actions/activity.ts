"use server";

import { getActivitySince } from "@/lib/db/activity";
import { getLoggingStreak } from "@/lib/db/dashboard";
import { formatCurrency } from "@/lib/format";

// Fixed order, matching the spec: transactions logged, goal progress,
// current streak, budgets crossed. At most one fact per category, so this
// is also the natural "never more than four facts" cap.
export async function getReturnSummaryFacts(sinceISO: string): Promise<string[]> {
  const [activityResult, streakResult] = await Promise.all([
    getActivitySince(sinceISO),
    getLoggingStreak(),
  ]);

  const facts: string[] = [];

  if (activityResult.data) {
    const { transactionCount, goalHighlight, crossedBudgetCategoryNames } = activityResult.data;

    if (transactionCount > 0) {
      facts.push(`${transactionCount} transaction${transactionCount === 1 ? "" : "s"}`);
    }
    if (goalHighlight) {
      facts.push(`${goalHighlight.goalName} +${formatCurrency(goalHighlight.amount)}`);
    }
    if (streakResult.data && streakResult.data.current > 0) {
      facts.push(`${streakResult.data.current}-day streak going`);
    }
    if (crossedBudgetCategoryNames.length === 1) {
      facts.push(`${crossedBudgetCategoryNames[0]} over budget`);
    } else if (crossedBudgetCategoryNames.length > 1) {
      facts.push(`${crossedBudgetCategoryNames.length} budgets over`);
    }
  }

  return facts;
}
