import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import type { GoalType } from "@/lib/goalOptions";
import { describeReadError, describeWriteError, sessionUserId } from "@/lib/db/errors";
import { isSafeToSpendCommitment } from "@/lib/safeToSpend";
import type { SameMoneyPair } from "@/lib/goalLinks";
import { isLiabilityAccountType } from "@/lib/accountOptions";

type GoalRow = Database["public"]["Tables"]["goals"]["Row"];
type GoalInsert = Database["public"]["Tables"]["goals"]["Insert"];
type GoalUpdate = Database["public"]["Tables"]["goals"]["Update"];
type GoalContributionRow = Database["public"]["Tables"]["goal_contributions"]["Row"];

export type DbResult<T> = { data: T; error: null } | { data: null; error: string };

// A goal is created Manual (log a contribution yourself). A debt payoff
// goal can then follow a card (LinkedAccount, migration 70) -- only through
// linkGoalToCard(), never at create. TaggedTransactions is unused.
export type CreateGoalInput = {
  goal_name: string;
  goal_type: GoalType;
  target_amount: number;
  target_date?: string | null;
  monthly_contribution?: number | null;
  /** The recurring transfer that funds it automatically (migration 57). */
  funding_recurringid?: string | null;
};

/** A recurring transfer a goal can name as its funding (GoalForm's picker). */
export type FundingTransfer = {
  id: string;
  description: string;
  amount: number;
  frequency: string;
  toAccountName: string;
};

// The transfers safe to spend counts as money leaving the spendable set --
// the same classifier the projection uses (isSafeToSpendCommitment), so a
// transfer that wouldn't be deducted (Checking -> Cash, or from Savings) is
// never offered as a goal's funding. v_upcoming_recurring already drops
// paused and ended schedules.
export async function listFundingTransfers(): Promise<DbResult<FundingTransfer[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_upcoming_recurring")
    .select("recurring_id, description, amount, frequency, account_type, to_accountid, to_account_type, to_account_name")
    .not("to_accountid", "is", null)
    .order("description");
  if (error) {
    return { data: null, error: describeReadError(error, "recurring") };
  }
  return {
    data: data.flatMap((r) =>
      r.recurring_id !== null &&
      r.account_type !== null &&
      isSafeToSpendCommitment({
        transactionType: "Transfer",
        fromAccountType: r.account_type,
        toAccountType: r.to_account_type,
      })
        ? [
            {
              id: r.recurring_id,
              description: r.description ?? "",
              amount: Number(r.amount ?? 0),
              frequency: r.frequency ?? "",
              toAccountName: r.to_account_name ?? "",
            },
          ]
        : [],
    ),
    error: null,
  };
}

// Each goal's funding link, for pre-filling the edit form -- v_goal_progress
// doesn't carry it.
export async function listGoalFundingLinks(): Promise<DbResult<Map<string, string>>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("goals")
    .select("id, funding_recurringid")
    .not("funding_recurringid", "is", null);
  if (error) {
    return { data: null, error: describeReadError(error, "goal") };
  }
  return { data: new Map(data.map((g) => [g.id, g.funding_recurringid as string])), error: null };
}

/** A goal the recurring transfer form can link to ("Is this for a goal?"). */
export type GoalOption = {
  id: string;
  name: string;
  monthlyContribution: number | null;
  fundingRecurringId: string | null;
};

// Active, uncompleted goals -- the ones a transfer can still be for. A goal
// that follows a card is never one (migration 70): payments count through
// the card's balance, and the database refuses the link. Each
// carries its current link, so the form can show which goal a schedule
// already funds.
export async function listGoalOptions(): Promise<DbResult<GoalOption[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("goals")
    .select("id, goal_name, monthly_contribution, funding_recurringid")
    .eq("is_active", true)
    .is("completed_at", null)
    .neq("tracking_method", "LinkedAccount")
    .order("goal_name");
  if (error) {
    return { data: null, error: describeReadError(error, "goal") };
  }
  return {
    data: data.map((g) => ({
      id: g.id,
      name: g.goal_name,
      monthlyContribution: g.monthly_contribution === null ? null : Number(g.monthly_contribution),
      fundingRecurringId: g.funding_recurringid,
    })),
    error: null,
  };
}

// The recurring form's side of the link: this schedule funds goalId, or no
// goal (null). set_goal_funding (migration 57) moves it in one call --
// every other goal this schedule funded is unlinked.
export async function setGoalFunding(recurringId: string, goalId: string | null): Promise<DbResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(
    "set_goal_funding",
    goalId === null ? { p_recurringid: recurringId } : { p_recurringid: recurringId, p_goalid: goalId },
  );
  if (error) {
    return { data: null, error: describeWriteError(error, "goal") };
  }
  return { data: null, error: null };
}

// Whether id names a recurring TRANSFER this user owns (RLS answers
// "owns"). The picker only offers counted ones; this is the server's
// guard against anything else arriving in the form.
export async function isRecurringTransfer(id: string): Promise<DbResult<boolean>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recurring_transactions")
    .select("id")
    .eq("id", id)
    .not("to_accountid", "is", null)
    .maybeSingle();
  if (error) {
    return { data: null, error: describeReadError(error, "recurring") };
  }
  return { data: data !== null, error: null };
}

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

// Changing the type stops a goal following its card (migration 70): a Debt
// Payoff goal switched to Vacation has no business still pointing at a
// credit card. unlink_goal_from_card() runs first, keeping the number,
// then the edit lands on a manual goal. An edit that keeps the type
// leaves the link alone.
export async function updateGoal(id: string, input: UpdateGoalInput): Promise<DbResult<GoalRow>> {
  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from("goals")
    .select("goal_type, tracking_method")
    .eq("id", id)
    .single();

  if (readError) {
    return { data: null, error: describeReadError(readError, "goal") };
  }

  if (current.goal_type !== input.goal_type && current.tracking_method === "LinkedAccount") {
    const unlinked = await unlinkGoalFromCard(id);
    if (unlinked.error !== null) {
      return { data: null, error: unlinked.error };
    }
  }

  const update: GoalUpdate = { ...input };

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

// Archive: the accounts/categories soft delete (is_active). The goal leaves
// the goals list, the dashboard and "Saved toward your goals"; its
// contributions stay exactly as they are.
export async function archiveGoal(id: string): Promise<DbResult<{ id: string }>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("goals")
    .update({ is_active: false })
    .eq("id", id)
    .select("id")
    .single();

  if (error) {
    return { data: null, error: describeWriteError(error, "goal") };
  }

  return { data, error: null };
}

// The goal's first contribution date, for the completion line's "over four
// months" or "since March". Null when it has none. Goal money is
// v_goal_money (migration 69): hand entries and linked transactions.
export async function getFirstContributionDate(goalid: string): Promise<DbResult<string | null>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("v_goal_money")
    .select("date")
    .eq("goalid", goalid)
    .order("date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { data: null, error: describeReadError(error, "contribution") };
  }

  return { data: data?.date ?? null, error: null };
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

// ---------------------------------------------------------------------
// Transactions linked to a goal (migration 69)
// ---------------------------------------------------------------------

/** A transaction that counts toward a goal -- shown in the goal's history, edited from the transaction. */
export type GoalLinkedTransaction = {
  id: string;
  goalid: string;
  amount: number;
  date: string;
  description: string;
  isTransfer: boolean;
};

// Every linked transaction, newest first, for the per-goal history on
// /goals. Its amount is the transaction's own (never a copy); editing it
// happens on the transaction.
export async function getGoalLinkedTransactions(): Promise<DbResult<GoalLinkedTransaction[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("id, goalid, amount, transaction_date, description, transfer_group_id")
    .not("goalid", "is", null)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    return { data: null, error: describeReadError(error, "goals") };
  }
  return {
    data: data.flatMap((t) =>
      t.goalid
        ? [{
            id: t.id,
            goalid: t.goalid,
            amount: Number(t.amount),
            date: t.transaction_date,
            description: t.description,
            isTransfer: t.transfer_group_id !== null,
          }]
        : [],
    ),
    error: null,
  };
}

/** A goal's name, for a transaction linked to a goal the pickers no longer offer (archived or completed). */
export async function getGoalName(id: string): Promise<DbResult<string | null>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("goals").select("goal_name").eq("id", id).maybeSingle();
  if (error) {
    return { data: null, error: describeReadError(error, "goal") };
  }
  return { data: data?.goal_name ?? null, error: null };
}

// "Is this the same money?" after a save that links (same_goal_money,
// migration 69 -- the one rule). The nearest hand entry, named for the
// question; null when there's nothing to ask.
export async function getSameGoalMoney(transactionId: string): Promise<DbResult<SameMoneyPair | null>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("same_goal_money", { p_transaction_id: transactionId });
  if (error) {
    return { data: null, error: describeReadError(error, "goal") };
  }
  const first = data[0];
  if (!first) return { data: null, error: null };
  const name = await getGoalName(first.goalid);
  if (name.error !== null) return { data: null, error: name.error };
  return {
    data: {
      transactionId,
      contributionId: first.contribution_id,
      goalName: name.data ?? "your goal",
      amount: Number(first.amount),
      contributionDate: first.contribution_date,
    },
    error: null,
  };
}

// "Yes": the link replaces the hand entry -- only while they still match.
export async function replaceContributionWithLink(
  transactionId: string,
  contributionId: string,
): Promise<DbResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("replace_contribution_with_link", {
    p_transaction_id: transactionId,
    p_contribution_id: contributionId,
  });
  if (error) {
    if (error.code === "P0002") {
      return { data: null, error: "That contribution has changed since, so nothing was removed." };
    }
    return { data: null, error: describeWriteError(error, "contribution") };
  }
  return { data: null, error: null };
}

/** A card a debt payoff goal can follow: a liability that owes something now. */
export type FollowableCard = { id: string; name: string; owed: number };

// Active liability accounts (isLiabilityAccountType -- Credit Card or
// Loan, is_liability_account_type() in SQL) that owe something now.
// link_goal_to_card() checks all of this again; this is the picker.
export async function listFollowableCards(): Promise<DbResult<FollowableCard[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_account_balances")
    .select("account_id, account_name, account_type, balance")
    .eq("is_active", true)
    .order("account_name");
  if (error) {
    return { data: null, error: describeReadError(error, "account") };
  }
  return {
    data: data.flatMap((a) =>
      a.account_id !== null && isLiabilityAccountType(a.account_type ?? "") && Number(a.balance ?? 0) < 0
        ? [{ id: a.account_id, name: a.account_name ?? "", owed: -Number(a.balance) }]
        : [],
    ),
    error: null,
  };
}

/** A goal that follows a card, for the transaction form's note beside the Goal field. */
export type FollowedGoal = { id: string; name: string; accountId: string };

export async function listFollowedGoals(): Promise<DbResult<FollowedGoal[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("goals")
    .select("id, goal_name, accountid")
    .eq("is_active", true)
    .eq("tracking_method", "LinkedAccount")
    .order("goal_name");
  if (error) {
    return { data: null, error: describeReadError(error, "goal") };
  }
  return {
    data: data.flatMap((g) => (g.accountid ? [{ id: g.id, name: g.goal_name, accountId: g.accountid }] : [])),
    error: null,
  };
}

// The goal starts following the card (migration 70): what the card owes
// now becomes its starting balance, once. Its contributions and linked
// transactions stay as history and stop counting -- the form says so first.
export async function linkGoalToCard(goalId: string, accountId: string): Promise<DbResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("link_goal_to_card", { p_goal_id: goalId, p_account_id: accountId });
  if (error) {
    return { data: null, error: describeWriteError(error, "goal") };
  }
  return { data: null, error: null };
}

// The goal goes back to manual and keeps its number: the progress made
// while following becomes one carried-over contribution. Returns that amount.
export async function unlinkGoalFromCard(goalId: string): Promise<DbResult<number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unlink_goal_from_card", { p_goal_id: goalId });
  if (error) {
    return { data: null, error: describeWriteError(error, "goal") };
  }
  return { data: Number(data ?? 0), error: null };
}

/** Every goal's completed_at, keyed by id -- the "before" half of a completion check. */
export async function getGoalCompletionStates(): Promise<DbResult<Map<string, string | null>>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("goals").select("id, completed_at").eq("is_active", true);
  if (error) {
    return { data: null, error: describeReadError(error, "goal") };
  }
  return { data: new Map(data.map((g) => [g.id, g.completed_at])), error: null };
}
