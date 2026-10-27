import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import type { GoalType } from "@/lib/goalOptions";
import { describeReadError, describeWriteError, sessionUserId } from "@/lib/db/errors";

type GoalRow = Database["public"]["Tables"]["goals"]["Row"];
type GoalInsert = Database["public"]["Tables"]["goals"]["Insert"];
type GoalUpdate = Database["public"]["Tables"]["goals"]["Update"];
type GoalContributionRow = Database["public"]["Tables"]["goal_contributions"]["Row"];

export type DbResult<T> = { data: T; error: null } | { data: null; error: string };

// This app only ever offers Manual tracking (log a contribution yourself) --
// LinkedAccount and TaggedTransactions are valid per goals_tracking_method_check
// but there's no UI here to wire up either, so they're not exposed.
export type CreateGoalInput = {
  goal_name: string;
  goal_type: GoalType;
  target_amount: number;
  target_date?: string | null;
  monthly_contribution?: number | null;
};

export async function createGoal(input: CreateGoalInput): Promise<DbResult<GoalRow>> {
  const supabase = await createClient();

  const session = sessionUserId(await supabase.auth.getClaims(), "goal");
  if (session.userid === null) {
    return { data: null, error: session.error };
  }
  const { userid } = session;

  const insert: GoalInsert = {
    ...input,
    tracking_method: "Manual",
    userid,
  };

  const { data, error } = await supabase.from("goals").insert(insert).select().single();

  if (error) {
    return { data: null, error: describeWriteError(error, "goal") };
  }

  return { data, error: null };
}

export type UpdateGoalInput = CreateGoalInput;

// Changing the type clears any link to an account: a Debt Payoff goal
// switched to Vacation has no business still pointing at a credit card.
// The current type is read first so an edit that keeps the type leaves
// the link alone.
export async function updateGoal(id: string, input: UpdateGoalInput): Promise<DbResult<GoalRow>> {
  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from("goals")
    .select("goal_type")
    .eq("id", id)
    .single();

  if (readError) {
    return { data: null, error: describeReadError(readError, "goal") };
  }

  const update: GoalUpdate =
    current.goal_type === input.goal_type
      ? { ...input }
      : { ...input, accountid: null, tracking_method: "Manual" };

  const { data, error } = await supabase.from("goals").update(update).eq("id", id).select().single();

  if (error) {
    return { data: null, error: describeWriteError(error, "goal") };
  }

  return { data, error: null };
}

// A real DELETE. goal_contributions.goalid is ON DELETE CASCADE, so the
// goal's contributions go with it, and v_goals_summary re-sums what's left
// on the next read -- there's no stored total to correct.
// transactions.goalid is ON DELETE SET NULL: no transaction goes with it.
export async function deleteGoal(id: string): Promise<DbResult<{ id: string }>> {
  const supabase = await createClient();

  const { data, error } = await supabase.from("goals").delete().eq("id", id).select("id").single();

  if (error) {
    return { data: null, error: describeWriteError(error, "goal") };
  }

  return { data, error: null };
}

export type ContributeToGoalInput = {
  amount: number;
  date: string;
};

// funding_method is always "manual" with no linked transactionid here --
// goal_contributions_funding_method_check requires the pairing (manual +
// null id, or transaction + a real id), and this app never links a
// transaction to a contribution.
export async function contributeToGoal(
  goalid: string,
  input: ContributeToGoalInput,
): Promise<DbResult<GoalContributionRow>> {
  const supabase = await createClient();

  const session = sessionUserId(await supabase.auth.getClaims(), "goal");
  if (session.userid === null) {
    return { data: null, error: session.error };
  }
  const { userid } = session;

  const { data, error } = await supabase
    .from("goal_contributions")
    .insert({ ...input, goalid, userid, funding_method: "manual" })
    .select()
    .single();

  if (error) {
    return { data: null, error: describeWriteError(error, "contribution") };
  }

  return { data, error: null };
}

export type GoalContribution = Pick<GoalContributionRow, "id" | "goalid" | "amount" | "date">;

// Every contribution, newest first, for the per-goal history on /goals. The
// goal's total is never added up from these -- v_goal_progress sums the
// table on each read, which is also why deleting or editing one is enough to
// recompute the goal: there is no stored total to keep in step.
export async function getGoalContributions(): Promise<DbResult<GoalContribution[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("goal_contributions")
    .select("id, goalid, amount, date")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return { data: null, error: describeReadError(error, "goals") };
  }

  return { data, error: null };
}

export async function updateGoalContribution(
  id: string,
  input: ContributeToGoalInput,
): Promise<DbResult<GoalContribution>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("goal_contributions")
    .update(input)
    .eq("id", id)
    .select("id, goalid, amount, date")
    .single();

  if (error) {
    return { data: null, error: describeWriteError(error, "contribution") };
  }

  return { data, error: null };
}

// A real DELETE, never a hidden flag: a hidden row would still be in
// v_goal_progress's sum, and the goal would keep counting money that was
// taken back out.
export async function deleteGoalContribution(id: string): Promise<DbResult<{ id: string }>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("goal_contributions")
    .delete()
    .eq("id", id)
    .select("id")
    .single();

  if (error) {
    return { data: null, error: describeWriteError(error, "contribution") };
  }

  return { data, error: null };
}
