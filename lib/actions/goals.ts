"use server";

import { revalidatePath } from "next/cache";
import { createGoal, contributeToGoal } from "@/lib/db/goals";
import { getGoalProgress } from "@/lib/db/dashboard";
import { GOAL_TYPES, type GoalType } from "@/lib/goalOptions";
import { formatCurrency } from "@/lib/format";

const VALID_TYPES = new Set<GoalType>(GOAL_TYPES);

export type ActionState = { error?: string } | undefined;

function parseGoalFields(formData: FormData) {
  const goal_name = String(formData.get("goal_name") ?? "").trim();
  const goal_type = String(formData.get("goal_type") ?? "");
  const target_amount = Number(String(formData.get("target_amount") ?? "").trim());
  const target_date = String(formData.get("target_date") ?? "").trim();
  const monthlyRaw = String(formData.get("monthly_contribution") ?? "").trim();

  if (!goal_name) {
    return { error: "Goal name is required." };
  }
  if (!VALID_TYPES.has(goal_type as GoalType)) {
    return { error: "Choose a goal type." };
  }
  if (!Number.isFinite(target_amount) || target_amount <= 0) {
    return { error: "Enter a target amount greater than zero." };
  }
  if (monthlyRaw) {
    const monthly_contribution = Number(monthlyRaw);
    if (!Number.isFinite(monthly_contribution) || monthly_contribution < 0) {
      return { error: "Monthly contribution can't be negative." };
    }
    return {
      goal_name,
      goal_type: goal_type as GoalType,
      target_amount,
      target_date: target_date || null,
      monthly_contribution,
    };
  }

  return {
    goal_name,
    goal_type: goal_type as GoalType,
    target_amount,
    target_date: target_date || null,
    monthly_contribution: null,
  };
}

export async function createGoalAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseGoalFields(formData);
  if ("error" in parsed) {
    return parsed;
  }

  const { error } = await createGoal(parsed);

  if (error) {
    return { error };
  }

  revalidatePath("/goals");
}

export type ContributeActionState =
  | { error?: string; milestone?: { message: string } }
  | undefined;

export async function contributeToGoalAction(
  _prevState: ContributeActionState,
  formData: FormData,
): Promise<ContributeActionState> {
  const goalid = String(formData.get("goalid") ?? "");
  const date = String(formData.get("date") ?? "").trim();
  const amount = Number(String(formData.get("amount") ?? "").trim());

  if (!goalid) {
    return { error: "Missing goal id." };
  }
  if (!date || Number.isNaN(Date.parse(date))) {
    return { error: "Enter a valid date." };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter an amount greater than zero." };
  }

  const { error } = await contributeToGoal(goalid, { amount, date });

  if (error) {
    return { error };
  }

  revalidatePath("/goals");

  // The celebration names the goal and the running total -- "$240 toward
  // Japan" -- so it reads from the same view the page does, not the raw
  // contribution just inserted (contributed_amount is the view's running
  // sum, never re-added in JS).
  const progressResult = await getGoalProgress();
  const goal = progressResult.data?.find((row) => row.goal_id === goalid);

  if (goal && goal.contributed_amount !== null && goal.goal_name) {
    return {
      milestone: { message: `${formatCurrency(goal.contributed_amount)} toward ${goal.goal_name}` },
    };
  }

  return undefined;
}
