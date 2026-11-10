import { test } from "node:test";
import assert from "node:assert/strict";
import { getChronicOverBudgetInsight } from "./budgetInsights";

const row = (budget_month: string, is_over_budget: boolean, actual_spend: number) => ({
  budget_month,
  is_over_budget,
  actual_spend,
});

// Under standing amounts most months are carried, with no row of their
// own. The history rows come from budget_progress_for_month, carried or
// not, so carried months count like any other.
test("carried months count: over in 2 of the last 3 fires", () => {
  const insight = getChronicOverBudgetInsight(
    [row("2026-08-01", true, 640), row("2026-09-01", false, 580), row("2026-10-01", true, 655)],
    "2026-11-01",
  );
  assert.deepEqual(insight, { overCount: 2, monthsConsidered: 3, suggestedAmount: 625 });
});

test("fewer than three budgeted months before this one: nothing said", () => {
  assert.equal(
    getChronicOverBudgetInsight([row("2026-09-01", true, 700), row("2026-10-01", true, 700)], "2026-11-01"),
    null,
  );
});

test("the viewed month and later never count", () => {
  assert.equal(
    getChronicOverBudgetInsight(
      [row("2026-09-01", true, 700), row("2026-10-01", true, 700), row("2026-11-01", true, 700)],
      "2026-11-01",
    ),
    null,
  );
});

test("over in only one of three: nothing said", () => {
  assert.equal(
    getChronicOverBudgetInsight(
      [row("2026-08-01", true, 700), row("2026-09-01", false, 500), row("2026-10-01", false, 500)],
      "2026-11-01",
    ),
    null,
  );
});
