"use server";

import { revalidatePath } from "next/cache";
import { createBudget, updateBudget, deleteBudget } from "@/lib/db/budgets";

export type ActionState = { error?: string } | undefined;

type ParsedBudgetFields = {
  categoryid: string;
  budget_month: string;
  budget_amount: number;
};

// Shared by create and update -- both forms offer the exact same fields.
// budget_month arrives as "YYYY-MM" from the <input type="month"> and gets
// normalized to the 1st here, matching the budgets_month_is_first CHECK.
function parseBudgetFields(formData: FormData): ParsedBudgetFields | { error: string } {
  const categoryid = String(formData.get("categoryid") ?? "");
  const monthInput = String(formData.get("budget_month") ?? "");
  const amountInput = String(formData.get("budget_amount") ?? "").trim();

  if (!categoryid) {
    return { error: "Choose a category." };
  }
  if (!/^\d{4}-\d{2}$/.test(monthInput)) {
    return { error: "Choose a month." };
  }

  const budget_amount = Number(amountInput);
  if (!Number.isFinite(budget_amount) || budget_amount <= 0) {
    return { error: "Enter a budget amount greater than zero." };
  }

  return { categoryid, budget_month: `${monthInput}-01`, budget_amount };
}

export async function createBudgetAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseBudgetFields(formData);
  if ("error" in parsed) {
    return parsed;
  }

  const { error } = await createBudget(parsed);

  if (error) {
    return { error };
  }

  revalidatePath("/budgets");
}

export async function updateBudgetAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) {
    return { error: "Missing budget id." };
  }

  const parsed = parseBudgetFields(formData);
  if ("error" in parsed) {
    return parsed;
  }

  const { error } = await updateBudget(id, parsed);

  if (error) {
    return { error };
  }

  revalidatePath("/budgets");
}

// Unlike categories/accounts this is a hard delete -- nothing references
// budgets.id, so there's no history to preserve.
export async function deleteBudgetAction(id: string): Promise<ActionState> {
  if (!id) {
    return { error: "Missing budget id." };
  }

  const { error } = await deleteBudget(id);

  if (error) {
    return { error };
  }

  revalidatePath("/budgets");
}
