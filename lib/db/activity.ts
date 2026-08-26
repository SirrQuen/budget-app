import "server-only";
import { createClient } from "@/lib/supabase/server";

export type DbResult<T> = { data: T; error: null } | { data: null; error: string };

export type ActivitySince = {
  transactionCount: number;
  goalHighlight: { goalName: string; amount: number } | null;
  crossedBudgetCategoryNames: string[];
};

// Local calendar month, not UTC -- see AddTransactionForm's todayISO for why
// the offset adjustment matters near midnight. Matches the normalization
// budgets.budget_month already uses (always the 1st of the month).
function currentMonthBoundsISO(): { start: string; end: string } {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  const start = `${local.toISOString().slice(0, 7)}-01`;
  const [y, m] = start.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(y, m, 1));
  const end = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return { start, end };
}

type GoalContributionJoinRow = {
  amount: number;
  goal: { goal_name: string } | null;
};

// Everything here is either a count/existence check or a value the database
// already computed (v_budget_vs_actual.is_over_budget, a single
// goal_contributions.amount) -- never a sum of `amount` done in JS. Budgets
// "crossed" is approximated as: currently over budget, and touched by at
// least one expense logged since `sinceISO` -- true crossing would need a
// spend-as-of-`since` figure, which would mean summing transactions.amount
// in JS (against the project's money rules) or a new SQL function.
export async function getActivitySince(sinceISO: string): Promise<DbResult<ActivitySince>> {
  const supabase = await createClient();
  const { start, end } = currentMonthBoundsISO();

  const [txCountRes, goalRes, overBudgetRes, recentExpenseCategoriesRes] = await Promise.all([
    supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sinceISO),
    supabase
      .from("goal_contributions")
      .select("amount, goal:goals(goal_name)")
      .gte("created_at", sinceISO)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .returns<GoalContributionJoinRow | null>(),
    supabase
      .from("v_budget_vs_actual")
      .select("category_id, category_name")
      .eq("budget_month", start)
      .eq("is_over_budget", true),
    supabase
      .from("transactions")
      .select("categoryid")
      .eq("transaction_type", "Expense")
      .is("transfer_group_id", null)
      .gte("created_at", sinceISO)
      .gte("transaction_date", start)
      .lt("transaction_date", end),
  ]);

  if (txCountRes.error) return { data: null, error: txCountRes.error.message };
  if (goalRes.error) return { data: null, error: goalRes.error.message };
  if (overBudgetRes.error) return { data: null, error: overBudgetRes.error.message };
  if (recentExpenseCategoriesRes.error) {
    return { data: null, error: recentExpenseCategoriesRes.error.message };
  }

  const recentCategoryIds = new Set(
    recentExpenseCategoriesRes.data.map((row) => row.categoryid),
  );
  const crossedBudgetCategoryNames = overBudgetRes.data
    .filter((row) => row.category_id !== null && recentCategoryIds.has(row.category_id))
    .map((row) => row.category_name ?? "")
    .filter(Boolean);

  return {
    data: {
      transactionCount: txCountRes.count ?? 0,
      goalHighlight: goalRes.data
        ? { goalName: goalRes.data.goal?.goal_name ?? "Your goal", amount: goalRes.data.amount }
        : null,
      crossedBudgetCategoryNames,
    },
    error: null,
  };
}
