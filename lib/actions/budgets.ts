"use server";

import { revalidatePath } from "next/cache";
import { createBudget, setBudgetForMonth, deleteBudget } from "@/lib/db/budgets";
import { parseBudgetAmount } from "@/lib/budgetAmount";

export type ActionState = { error?: string } | undefined;

// budget_month arrives as "YYYY-MM" from the <input type="month"> (create)
// or as the row's own "YYYY-MM-01" (edit), and is normalized to the 1st,
// matching the budgets_month_is_first CHECK.
function parseMonth(formData: FormData): string | null {
  const raw = String(formData.get("budget_month") ?? "");
  const match = /^(\d{4}-\d{2})(-01)?$/.exec(raw);
  return match ? `${match[1]}-01` : null;
}

function revalidateBudgets() {
  revalidatePath("/budgets");
  revalidatePath("/dashboard");
}

// A category with no budget yet. If it already has one this month (a
// second tab, a month picked by hand), budgets_one_per_category_month
// refuses it with "There's already a budget for that category this month."
export async function createBudgetAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const categoryid = String(formData.get("categoryid") ?? "");
  if (!categoryid) {
    return { error: "Choose a category." };
  }
  const budget_month = parseMonth(formData);
  if (!budget_month) {
    return { error: "Choose a month." };
  }
  const amount = parseBudgetAmount(formData.get("budget_amount"));
  if ("error" in amount) {
    return amount;
  }

  const { error } = await createBudget({ categoryid, budget_month, budget_amount: amount.value });
  if (error) {
    return { error };
  }
  revalidateBudgets();
}

// Changing an amount -- whether this month has its own row or the amount
// was carried from an earlier one. Writes exactly one row: this category,
// this month. The category and month identify the budget; they're never
// changed by an edit, so an edit can't land on another budget's row.
export async function setBudgetAmountAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const categoryid = String(formData.get("categoryid") ?? "");
  const budget_month = parseMonth(formData);
  if (!categoryid || !budget_month) {
    return { error: "We couldn't tell which budget that was." };
  }
  const amount = parseBudgetAmount(formData.get("budget_amount"));
  if ("error" in amount) {
    return amount;
  }

  const { error } = await setBudgetForMonth({ categoryid, budget_month, budget_amount: amount.value });
  if (error) {
    return { error };
  }
  revalidateBudgets();
}

// Unlike categories/accounts this is a hard delete -- nothing references
// budgets.id, so there's no history to preserve. It removes this month's
// own row only; an earlier month's amount for the category then carries
// into this month again, if there is one.
export async function deleteBudgetAction(id: string): Promise<ActionState> {
  if (!id) {
    return { error: "Missing budget id." };
  }

  const { error } = await deleteBudget(id);

  if (error) {
    return { error };
  }

  revalidateBudgets();
}
