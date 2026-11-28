import "server-only";
import { getGoalCompletionStates, getFirstContributionDate, listFeedingSchedules, listGoalOptions } from "@/lib/db/goals";
import { scheduleLabel } from "@/lib/goalSchedules";
import { getGoalProgress } from "@/lib/db/dashboard";
import { getTimeZone, getToday } from "@/lib/db/settings";
import { todayInZone } from "@/lib/date";
import { completionCopy, freedUpLine, type FreedUp, type GoalCompletion } from "@/lib/goalCompletion";

// THE completion check (docs/Goal-Completion.md, D; migration 70): the one
// helper every server action uses to learn whether its own write completed
// a goal. The database keeps completed_at (53 for goal money, 69 for linked
// transactions, 70 for a goal that follows a card); an action reads every
// goal's completed_at BEFORE its write and asks AFTER it which went from
// null to set. Only that action's response carries the bloom -- nothing is
// stored to show it later, no cookie, no render detects it.
//
// A goal that follows a card can be completed by any write on that card --
// a payment, a confirmed card payment, a deleted charge -- so transaction
// actions take a snapshot too, not only goal actions.

/** Every active goal's completed_at, read before the action's write. undefined when unreadable -- then no celebration rather than a wrong one. */
export type CompletionSnapshot = Map<string, string | null> | undefined;

export async function completionSnapshot(): Promise<CompletionSnapshot> {
  try {
    const result = await getGoalCompletionStates();
    return result.error === null ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/** The goal this action's write completed, as the panel's copy; undefined when none. */
export async function completedSince(before: CompletionSnapshot): Promise<GoalCompletion | undefined> {
  if (before === undefined) return undefined;
  try {
    const after = await getGoalCompletionStates();
    if (after.error !== null) return undefined;
    const goalId = [...after.data].find(([id, at]) => at !== null && before.has(id) && before.get(id) === null)?.[0];
    if (goalId === undefined) return undefined;

    const [progressResult, firstResult, today, timeZone] = await Promise.all([
      getGoalProgress(),
      getFirstContributionDate(goalId),
      getToday(),
      getTimeZone(),
    ]);
    const goal = progressResult.data?.find((row) => row.goal_id === goalId);
    if (!goal || !goal.goal_name || !goal.goal_type || goal.contributed_amount === null || goal.target_amount === null) {
      return undefined;
    }

    // A goal that follows a card cleared what the card owed when it started
    // following, since then -- not its old hand entries.
    const follows = goal.tracking_method === "LinkedAccount" && goal.starting_balance !== null;
    const copy = completionCopy({
      goalId,
      goalName: goal.goal_name,
      goalType: goal.goal_type,
      contributed: follows ? Number(goal.starting_balance) : goal.contributed_amount,
      targetAmount: goal.target_amount,
      targetDate: goal.target_date,
      firstContributionDate:
        follows && goal.linked_at ? todayInZone(timeZone, new Date(goal.linked_at)) : (firstResult.data ?? null),
      completedOn: today,
    });
    return { ...copy, freed: follows ? null : await freedUp(goalId) };
  } catch {
    // The write already succeeded: a failure here costs the panel, never the save.
    return undefined;
  }
}

// The schedules still feeding the goal that just completed, by the link
// itself -- identified with confidence, or not at all: a failed read drops
// the line rather than name a wrong figure (docs/Goal-Completion.md).
async function freedUp(goalId: string): Promise<FreedUp | null> {
  const [schedules, goals] = await Promise.all([listFeedingSchedules(), listGoalOptions()]);
  if (schedules.error !== null) return null;
  const feeding = schedules.data.filter((s) => s.goalId === goalId);
  const labels = feeding.map(scheduleLabel);
  const line = freedUpLine(labels);
  if (line === null) return null;
  return {
    line,
    schedules: feeding.map((s, k) => ({ id: s.id, label: labels[k] })),
    redirectTo: (goals.data ?? []).filter((g) => g.id !== goalId).map((g) => ({ id: g.id, name: g.name })),
  };
}
