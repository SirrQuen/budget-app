"use server";

import { revalidatePath } from "next/cache";
import { setBudgetForMonth, stopBudgetingForMonth } from "@/lib/db/budgets";
import { parseBudgetAmount } from "@/lib/budgetAmount";

export type ActionState = { error?: string } | undefined;

// budget_month arrives as the viewed month's "YYYY-MM-01" (a hidden field
// on every budget form) and is normalized to the 1st, matching the
// budgets_month_is_first CHECK.
function parseMonth(formData: FormData): string | null {
  return normalizeMonth(String(formData.get("budget_month") ?? ""));
}

function normalizeMonth(raw: string): string | null {
  const match = /^(\d{4}-\d{2})(-01)?$/.exec(raw);
  return match ? `${match[1]}-01` : null;
}

function revalidateBudgets() {
  revalidatePath("/budgets");
  revalidatePath("/dashboard");
}

// A category with no budget this month -- never had one, or stopped. It's
// the same write as changing an amount: one row, this category, the
// viewed month, upserted on budgets_one_per_category_month. "Add budget"
// only offers categories with nothing this month, so it never silently
// replaces an amount someone set; if a second tab did, the amount entered
// last stands, and there is still one row.
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

  const { error } = await setBudgetForMonth({ categoryid, budget_month, budget_amount: amount.value });
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

// "Stop budgeting": deliberately not budgeted from this month on -- a
// tombstone row, never a delete. Deleting the month's row would only bring
// an earlier amount back, which isn't what "stop" means. Earlier months keep
// their amounts; setting an amount again later starts it again.
export async function stopBudgetingAction(categoryid: string, budgetMonth: string): Promise<ActionState> {
  const budget_month = normalizeMonth(budgetMonth);
  if (!categoryid || !budget_month) {
    return { error: "We couldn't tell which budget that was." };
  }

  const { error } = await stopBudgetingForMonth({ categoryid, budget_month });
  if (error) {
    return { error };
  }
  revalidateBudgets();
}
