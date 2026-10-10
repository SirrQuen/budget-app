"use server";

import { getActivitySince } from "@/lib/db/activity";
import { formatCurrency } from "@/lib/format";

// A few hours away is the bar for a "since you were last here" strip -- a
// page hop earlier in the same session doesn't count.
const AWAY_MS = 4 * 60 * 60 * 1000;

// Fixed order, matching the spec: transactions logged, goal progress,
// budgets crossed. At most one fact per category, so this is also the
// natural cap. The spec's "current streak" fact is off until the streak is
// redefined as days opened (docs/phase-7-findings.md) -- as built it counts
// days with a transaction, which rewards spending. Returns [] when the
// last visit was too recent, or when genuinely nothing changed -- the
// caller renders nothing on an empty list either way.
export async function getReturnSummaryFacts(sinceISO: string): Promise<string[]> {
  const sinceMs = Date.parse(sinceISO);
  if (Number.isNaN(sinceMs) || Date.now() - sinceMs < AWAY_MS) {
    return [];
  }

  const activityResult = await getActivitySince(sinceISO);

  const facts: string[] = [];

  if (activityResult.data) {
    const { transactionCount, goalHighlight, crossedBudgetCategoryNames } = activityResult.data;

    if (transactionCount > 0) {
      facts.push(`${transactionCount} transaction${transactionCount === 1 ? "" : "s"}`);
    }
    if (goalHighlight) {
      facts.push(`${goalHighlight.goalName} +${formatCurrency(goalHighlight.amount)}`);
    }
    if (crossedBudgetCategoryNames.length === 1) {
      facts.push(`${crossedBudgetCategoryNames[0]} over budget`);
    } else if (crossedBudgetCategoryNames.length > 1) {
      facts.push(`${crossedBudgetCategoryNames.length} budgets over`);
    }
  }

  return facts;
}
