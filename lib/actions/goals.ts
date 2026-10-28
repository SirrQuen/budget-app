"use server";

import { revalidatePath } from "next/cache";
import {
  archiveGoal,
  createGoal,
  contributeToGoal,
  deleteGoal,
  deleteGoalContribution,
  getContributionGoalId,
  getFirstContributionDate,
  getGoalCompletedAt,
  updateGoal,
  updateGoalContribution,
} from "@/lib/db/goals";
import { getGoalProgress } from "@/lib/db/dashboard";
import { getToday } from "@/lib/db/settings";
import { GOAL_TYPES, type GoalType } from "@/lib/goalOptions";
import { completionCopy, type GoalCompletion } from "@/lib/goalCompletion";
import { formatCurrency } from "@/lib/format";

const VALID_TYPES = new Set<GoalType>(GOAL_TYPES);

// `completed` is set only by the action whose write completed the goal,
// and only in that response: the panel shows in that interaction and
// nothing is stored to show it later. Reloading, or another device,
// shows nothing.
export type ActionState = { error?: string; completed?: GoalCompletion } | undefined;

// completed_at before this action's write. undefined when it can't be
// read -- then there's no celebration rather than a wrong one.
async function completedAtBefore(goalid: string): Promise<string | null | undefined> {
  const result = await getGoalCompletedAt(goalid);
  return result.error === null ? result.data : undefined;
}

// Completion is detected HERE, in the server action that wrote the change,
// after the write, never during a render (docs/Goal-Completion.md, D). The
// database re-derives completed_at on every write (migration 53); a
// change from null to set across this action's write is a completion.
// Reversal is the same column going back to null -- silently: nothing is
// returned for it.
async function detectCompletion(
  goalid: string,
  before: string | null | undefined,
): Promise<GoalCompletion | undefined> {
  if (before !== null) return undefined;
  const after = await getGoalCompletedAt(goalid);
  if (after.error !== null || after.data === null) return undefined;

  const [progressResult, firstResult, today] = await Promise.all([
    getGoalProgress(),
    getFirstContributionDate(goalid),
    getToday(),
  ]);
  const goal = progressResult.data?.find((row) => row.goal_id === goalid);
  if (!goal || !goal.goal_name || !goal.goal_type || goal.contributed_amount === null || goal.target_amount === null) {
    return undefined;
  }

  return completionCopy({
    goalId: goalid,
    goalName: goal.goal_name,
    goalType: goal.goal_type,
    contributed: goal.contributed_amount,
    targetAmount: goal.target_amount,
    targetDate: goal.target_date,
    firstContributionDate: firstResult.data ?? null,
    completedOn: today,
  });
}

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

export async function updateGoalAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) {
    return { error: "Missing goal id." };
  }
  const parsed = parseGoalFields(formData);
  if ("error" in parsed) {
    return parsed;
  }

  // A lowered target can complete the goal; a raised one un-completes it.
  const before = await completedAtBefore(id);
  const { error } = await updateGoal(id, parsed);

  if (error) {
    return { error };
  }

  revalidatePath("/goals");
  revalidatePath("/dashboard");

  const completed = await detectCompletion(id, before);
  return completed ? { completed } : undefined;
}

// Archive, not delete: the goal leaves the goals list, the dashboard and
// "Saved toward your goals"; its contributions stay.
export async function archiveGoalAction(id: string): Promise<ActionState> {
  if (!id) {
    return { error: "Missing goal id." };
  }

  const { error } = await archiveGoal(id);

  if (error) {
    return { error };
  }

  revalidatePath("/goals");
  revalidatePath("/dashboard");
}

export async function deleteGoalAction(id: string): Promise<ActionState> {
  if (!id) {
    return { error: "Missing goal id." };
  }

  const { error } = await deleteGoal(id);

  if (error) {
    return { error };
  }

  // "Saved toward your goals" and the dashboard meters re-read the views,
  // which no longer see the goal or its contributions.
  revalidatePath("/goals");
  revalidatePath("/dashboard");
}

// Shared by logging a contribution and editing one, so the two can't
// accept different amounts or dates.
function parseContributionFields(formData: FormData) {
  const date = String(formData.get("date") ?? "").trim();
  const amount = Number(String(formData.get("amount") ?? "").trim());

  if (!date || Number.isNaN(Date.parse(date))) {
    return { error: "Enter a valid date." };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter an amount greater than zero." };
  }
  return { amount, date };
}

export type ContributeActionState =
  | { error?: string; milestone?: { message: string }; completed?: GoalCompletion }
  | undefined;

export async function contributeToGoalAction(
  _prevState: ContributeActionState,
  formData: FormData,
): Promise<ContributeActionState> {
  const goalid = String(formData.get("goalid") ?? "");
  if (!goalid) {
    return { error: "Missing goal id." };
  }
  const parsed = parseContributionFields(formData);
  if ("error" in parsed) {
    return parsed;
  }

  const before = await completedAtBefore(goalid);
  const { error } = await contributeToGoal(goalid, parsed);

  if (error) {
    return { error };
  }

  revalidatePath("/goals");

  // The contribution that completes the goal gets the completion panel
  // instead of the running-total line -- one celebration, not two.
  const completed = await detectCompletion(goalid, before);
  if (completed) {
    return { completed };
  }

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

export async function updateContributionAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) {
    return { error: "Missing contribution id." };
  }
  const parsed = parseContributionFields(formData);
  if ("error" in parsed) {
    return parsed;
  }

  // Raising a contribution can complete its goal.
  const goal = await getContributionGoalId(id);
  const before = goal.error === null ? await completedAtBefore(goal.data) : undefined;
  const { error } = await updateGoalContribution(id, parsed);

  if (error) {
    return { error };
  }

  // The page re-reads v_goal_progress, which re-sums the table: the edited
  // amount is the goal's total and percentage from here on.
  revalidatePath("/goals");

  if (goal.error !== null) return undefined;
  const completed = await detectCompletion(goal.data, before);
  return completed ? { completed } : undefined;
}

export async function deleteContributionAction(id: string): Promise<ActionState> {
  if (!id) {
    return { error: "Missing contribution id." };
  }

  // Deleting the contribution that completed a goal un-completes it: the
  // database clears completed_at (migration 53). Silently -- nothing is
  // returned, nothing is shown.
  const { error } = await deleteGoalContribution(id);

  if (error) {
    return { error };
  }

  revalidatePath("/goals");
}
