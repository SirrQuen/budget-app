"use server";

import { revalidatePath } from "next/cache";
import {
  archiveGoal,
  createGoal,
  contributeToGoal,
  deleteGoal,
  deleteGoalContribution,
  getRecurringTransferLink,
  getSameGoalMoney,
  linkEarlierOccurrences,
  linkGoalToCard,
  setGoalFunding,
  unlinkGoalFromCard,
  updateGoal,
  updateGoalContribution,
} from "@/lib/db/goals";
import { getGoalProgress } from "@/lib/db/dashboard";
import { pauseRecurring } from "@/lib/db/recurring";
import { GOAL_TYPES, type GoalType } from "@/lib/goalOptions";
import type { GoalCompletion } from "@/lib/goalCompletion";
import { completedSince, completionSnapshot } from "@/lib/goalCompletionCheck";
import { formatCurrency } from "@/lib/format";
import type { SameMoneyPair } from "@/lib/goalLinks";

const VALID_TYPES = new Set<GoalType>(GOAL_TYPES);

// `completed` is set only by the action whose write completed the goal,
// and only in that response: the panel shows in that interaction and
// nothing is stored to show it later. Reloading, or another device,
// shows nothing.
export type ActionState = { error?: string; completed?: GoalCompletion } | undefined;

// Completion is detected in the server action that wrote the change,
// after the write, never during a render (docs/Goal-Completion.md, D), by
// the one shared check (lib/goalCompletionCheck.ts): a goal whose
// completed_at went from null to set across this action's write. Reversal
// is the same column going back to null -- silently: nothing is returned.

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

// The goal form's "Do you move this money automatically?": a schedule to
// ADD to this goal, or null. "No, leave it unlinked" to the duplicate
// question is null too. Nothing here ever unlinks: the link lives on the
// schedule (migration 82), and clearing the monthly target leaves it.
function scheduleToAdd(formData: FormData): string | null {
  const id = String(formData.get("add_schedule_id") ?? "").trim();
  if (!id) return null;
  if (formData.get("duplicate_asked") === "1" && formData.get("add_duplicate") !== "yes") return null;
  return id;
}

// The picker offers only the user's counted recurring transfers that feed
// no goal; anything else is refused rather than moved. Taking a schedule
// from another goal is done on the schedule, where the form says so.
// Ownership is the composite FK's guarantee too -- this is the readable error.
async function checkScheduleToAdd(recurringId: string | null, goalId: string | null): Promise<ActionState> {
  if (recurringId === null) return undefined;
  const result = await getRecurringTransferLink(recurringId);
  if (result.error !== null) return { error: result.error };
  if (result.data === null) return { error: "Choose one of your recurring transfers, or No." };
  if (result.data.goalId !== null && result.data.goalId !== goalId) {
    return { error: "That transfer already feeds another goal. Change it from the transfer on Recurring." };
  }
  return undefined;
}

export async function createGoalAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseGoalFields(formData);
  if ("error" in parsed) {
    return parsed;
  }
  const adding = scheduleToAdd(formData);
  const scheduleError = await checkScheduleToAdd(adding, null);
  if (scheduleError) {
    return scheduleError;
  }

  const created = await createGoal(parsed);

  if (created.error !== null) {
    return { error: created.error };
  }

  if (adding) {
    const linked = await setGoalFunding(adding, created.data.id);
    if (linked.error !== null) {
      revalidatePath("/goals");
      return { error: "Your goal is saved, but linking the transfer didn't work. Choose this goal on the transfer in Recurring." };
    }
    revalidatePath("/recurring");
  }

  revalidatePath("/goals");
  // A monthly target holds money in safe to spend.
  revalidatePath("/dashboard");
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
  const adding = scheduleToAdd(formData);
  const scheduleError = await checkScheduleToAdd(adding, id);
  if (scheduleError) {
    return scheduleError;
  }

  // A lowered target can complete the goal; a raised one un-completes it.
  const before = await completionSnapshot();
  const { error } = await updateGoal(id, parsed);

  if (error) {
    return { error };
  }

  if (adding) {
    const linked = await setGoalFunding(adding, id);
    if (linked.error !== null) {
      revalidatePath("/goals");
      return { error: "Your changes are saved, but linking the transfer didn't work. Try again, or choose this goal on the transfer in Recurring." };
    }
    revalidatePath("/recurring");
  }

  revalidatePath("/goals");
  revalidatePath("/dashboard");

  const completed = await completedSince(before);
  return completed ? { completed } : undefined;
}

// A debt payoff goal starts following a credit card or loan (migration 70).
// Linking can't complete it: the card owes something, or it couldn't be
// followed.
export async function linkGoalToCardAction(goalId: string, accountId: string): Promise<ActionState> {
  if (!goalId || !accountId) {
    return { error: "Choose a credit card or loan." };
  }
  const { error } = await linkGoalToCard(goalId, accountId);
  if (error) {
    return { error };
  }
  revalidatePath("/goals");
  // A followed goal holds nothing in safe to spend.
  revalidatePath("/dashboard");
}

// Back to manual, keeping the number (one carried-over contribution).
export async function unlinkGoalFromCardAction(goalId: string): Promise<ActionState> {
  if (!goalId) {
    return { error: "Missing goal id." };
  }
  const before = await completionSnapshot();
  const { error } = await unlinkGoalFromCard(goalId);
  if (error) {
    return { error };
  }
  revalidatePath("/goals");
  revalidatePath("/dashboard");
  const completed = await completedSince(before);
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

  const before = await completionSnapshot();
  const { error } = await contributeToGoal(goalid, parsed);

  if (error) {
    return { error };
  }

  revalidatePath("/goals");
  // A contribution changes this month's goal hold in safe to spend.
  revalidatePath("/dashboard");

  // The contribution that completes the goal gets the completion panel
  // instead of the running-total line -- one celebration, not two.
  const completed = await completedSince(before);
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
  const before = await completionSnapshot();
  const { error } = await updateGoalContribution(id, parsed);

  if (error) {
    return { error };
  }

  // The page re-reads v_goal_progress, which re-sums the table: the edited
  // amount is the goal's total and percentage from here on.
  revalidatePath("/goals");
  // A contribution changes this month's goal hold in safe to spend.
  revalidatePath("/dashboard");

  const completed = await completedSince(before);
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
  // A contribution changes this month's goal hold in safe to spend.
  revalidatePath("/dashboard");
}

// "Funded by" on the goal page: Unlink. The schedule keeps running and
// stops feeding this goal; no other schedule's link moves. Its confirmed
// transfers keep counting -- they're real money that went to the goal.
export async function unlinkScheduleAction(recurringId: string): Promise<ActionState> {
  if (!recurringId) {
    return { error: "Missing schedule id." };
  }
  const { error } = await setGoalFunding(recurringId, null);
  if (error) {
    return { error };
  }
  revalidatePath("/goals");
  revalidatePath("/recurring");
  // Its occurrences no longer net against the goal's hold.
  revalidatePath("/dashboard");
}

export type CountEarlierState = { error?: string; sameMoney?: SameMoneyPair[]; completed?: GoalCompletion } | undefined;

// "Count them" (ruling 1): only on a tap. Links the schedule's earlier
// confirmed transfers to its goal, then asks "Is this the same money?"
// for every one that matches a hand-entered contribution
// (same_goal_money) -- "Yes" replaces the hand entry, "No" keeps both.
export async function countEarlierOccurrencesAction(recurringId: string): Promise<CountEarlierState> {
  if (!recurringId) {
    return { error: "Missing schedule id." };
  }
  const before = await completionSnapshot();
  const linked = await linkEarlierOccurrences(recurringId);
  if (linked.error !== null) {
    return { error: linked.error };
  }
  revalidatePath("/goals");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");

  const sameMoney: SameMoneyPair[] = [];
  const used = new Set<string>();
  for (const transactionId of linked.data) {
    const pair = await getSameGoalMoney(transactionId);
    if (pair.error !== null) {
      return { error: "They're counted now, but checking them against your own entries didn't work. Look over this goal's history." };
    }
    // One hand entry answers for one transfer: two $50 transfers never
    // both get asked about the same $50 entry.
    if (pair.data && !used.has(pair.data.contributionId)) {
      used.add(pair.data.contributionId);
      sameMoney.push(pair.data);
    }
  }
  const completed = await completedSince(before);
  return { sameMoney, ...(completed ? { completed } : {}) };
}

// The completion panel's choices for a schedule still feeding a finished
// goal (docs/Goal-Completion.md, "The part only Sorrel can say").
// Stop pauses it -- reversible from Recurring, and its history stays.
export async function stopScheduleAction(recurringId: string): Promise<ActionState> {
  if (!recurringId) {
    return { error: "Missing schedule id." };
  }
  const { error } = await pauseRecurring(recurringId);
  if (error) {
    return { error };
  }
  revalidatePath("/recurring");
  revalidatePath("/goals");
  // A paused schedule leaves the forecast.
  revalidatePath("/dashboard");
}

// Redirect: the schedule feeds another goal from its next confirmation on.
// Only this schedule's link moves (set_goal_funding, migration 82).
export async function redirectScheduleAction(recurringId: string, goalId: string): Promise<ActionState> {
  if (!recurringId || !goalId) {
    return { error: "Choose a goal." };
  }
  const { error } = await setGoalFunding(recurringId, goalId);
  if (error) {
    return { error };
  }
  revalidatePath("/recurring");
  revalidatePath("/goals");
  revalidatePath("/dashboard");
}
