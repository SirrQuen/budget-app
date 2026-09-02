import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import type { GoalType } from "@/lib/goalOptions";
import { describeWriteError } from "@/lib/db/errors";

type GoalRow = Database["public"]["Tables"]["goals"]["Row"];
type GoalInsert = Database["public"]["Tables"]["goals"]["Insert"];
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

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userid = claimsData?.claims?.sub;

  if (claimsError || !userid) {
    return {
      data: null,
      error: "Your session's expired. Log in again to pick up where you left off.",
    };
  }

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

  const { data, error } = await supabase
    .from("goal_contributions")
    .insert({ ...input, goalid, funding_method: "manual" })
    .select()
    .single();

  if (error) {
    return { data: null, error: describeWriteError(error, "contribution") };
  }

  return { data, error: null };
}
