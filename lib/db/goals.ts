import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import type { GoalType } from "@/lib/goalOptions";
import { describeReadError, describeWriteError, sessionUserId } from "@/lib/db/errors";
import { isSafeToSpendCommitment } from "@/lib/safeToSpend";
import type { SameMoneyPair } from "@/lib/goalLinks";
import { isLiabilityAccountType } from "@/lib/accountOptions";
import { parseGoalPace, type GoalPace } from "@/lib/goalPace";
import { parseAmountBasis, type AmountBasis } from "@/lib/amountBasis";

type GoalRow = Database["public"]["Tables"]["goals"]["Row"];
type GoalInsert = Database["public"]["Tables"]["goals"]["Insert"];
type GoalUpdate = Database["public"]["Tables"]["goals"]["Update"];
type GoalContributionRow = Database["public"]["Tables"]["goal_contributions"]["Row"];

export type DbResult<T> = { data: T; error: null } | { data: null; error: string };

// A goal is created Manual (log a contribution yourself). A debt payoff
// goal can then follow a card (LinkedAccount, migration 70) -- only through
// linkGoalToCard(), never at create. TaggedTransactions is unused.
// The schedules that feed it are linked on the schedule
// (recurring_transactions.goalid, migration 82), through setGoalFunding.
export type CreateGoalInput = {
  goal_name: string;
  goal_type: GoalType;
  target_amount: number;
  target_date?: string | null;
  monthly_contribution?: number | null;
};

/**
 * A recurring transfer as the goal side shows it: a schedule that feeds a
 * goal (the "Funded by" list, the forms' hints, the completion line), or
 * one the goal form can add.
 */
export type FeedingSchedule = {
  id: string;
  /** recurring_transactions.goalid -- null for one that feeds nothing yet. */
  goalId: string | null;
  description: string;
  /** v_upcoming_recurring.amount -- what each occurrence is expected to be. */
  amount: number;
  /** What that amount rests on (AmountBasisTag). */
  basis: AmountBasis;
  frequency: string;
  intervalCount: number;
  /** The schedule's stable anchor (start_date, else the cursor) -- formatSchedule's. */
  anchorDate: string;
  accountId: string;
  toAccountId: string;
  toAccountName: string;
};

// Every live recurring transfer safe to spend counts as money leaving the
// spendable set (isSafeToSpendCommitment, the projection's classifier), with
// the goal it feeds. v_upcoming_recurring already drops paused and ended
// schedules, so a schedule that ended leaves every list -- its confirmed
// occurrences stay in the goal's history. A transfer that wouldn't be
// deducted (Checking -> Cash, or from Savings) isn't offered: it can't
// stand in for a goal's monthly target.
export async function listFeedingSchedules(): Promise<DbResult<FeedingSchedule[]>> {
  const supabase = await createClient();
  const [upcoming, links] = await Promise.all([
    supabase
      .from("v_upcoming_recurring")
      .select(
        "recurring_id, description, amount, amount_basis, frequency, interval_count, start_date, next_run_date, accountid, account_type, to_accountid, to_account_type, to_account_name",
      )
      .not("to_accountid", "is", null)
      .order("description"),
    supabase.from("recurring_transactions").select("id, goalid").not("goalid", "is", null),
  ]);
  if (upcoming.error) {
    return { data: null, error: describeReadError(upcoming.error, "recurring") };
  }
  if (links.error) {
    return { data: null, error: describeReadError(links.error, "recurring") };
  }
  const goalOf = new Map(links.data.map((r) => [r.id, r.goalid as string]));
  return {
    data: upcoming.data.flatMap((r) => {
      const basis = parseAmountBasis(r.amount_basis);
      return r.recurring_id !== null &&
        r.accountid !== null &&
        r.to_accountid !== null &&
        r.account_type !== null &&
        basis !== null &&
        isSafeToSpendCommitment({
          transactionType: "Transfer",
          fromAccountType: r.account_type,
          toAccountType: r.to_account_type,
        })
        ? [
            {
              id: r.recurring_id,
              goalId: goalOf.get(r.recurring_id) ?? null,
              description: r.description ?? "",
              amount: Number(r.amount ?? 0),
              basis,
              frequency: r.frequency ?? "",
              intervalCount: r.interval_count ?? 1,
              anchorDate: r.start_date ?? r.next_run_date ?? "",
              accountId: r.accountid,
              toAccountId: r.to_accountid,
              toAccountName: r.to_account_name ?? "",
            },
          ]
        : [];
    }),
    error: null,
  };
}

/** A goal a transaction or a recurring transfer can be for. */
export type GoalOption = {
  id: string;
  name: string;
  monthlyContribution: number | null;
};

// Active, uncompleted goals -- the ones a transfer can still be for. A goal
// that follows a card is never one (migration 70): payments count through
// the card's balance, and the database refuses the link.
export async function listGoalOptions(): Promise<DbResult<GoalOption[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("goals")
    .select("id, goal_name, monthly_contribution")
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
    })),
    error: null,
  };
}

// This schedule feeds goalId, or no goal (null). set_goal_funding
// (migration 82) writes that one schedule's goalid and nothing else: no
// other schedule's link moves.
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

/** A schedule's confirmed transfers that don't count toward the goal it feeds. */
export type UncountedOccurrences = { recurringId: string; count: number };

// Per schedule feeding a goal, how many of its confirmed transfers carry no
// goal -- confirmed before migration 82 auto-linked them, or cleared by
// hand. The goal page offers to count them; nothing counts them unasked
// (ruling 1). Counted rows, not money.
export async function listUncountedOccurrences(recurringIds: string[]): Promise<DbResult<UncountedOccurrences[]>> {
  if (recurringIds.length === 0) return { data: [], error: null };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("recurringid")
    .in("recurringid", recurringIds)
    .eq("transaction_type", "Expense")
    .not("transfer_group_id", "is", null)
    .is("goalid", null);
  if (error) {
    return { data: null, error: describeReadError(error, "goals") };
  }
  const counts = new Map<string, number>();
  for (const r of data) {
    if (r.recurringid) counts.set(r.recurringid, (counts.get(r.recurringid) ?? 0) + 1);
  }
  return { data: [...counts].map(([recurringId, count]) => ({ recurringId, count })), error: null };
}

// "Count them": the schedule's uncounted confirmed transfers start counting
// toward its goal (link_earlier_occurrences, migration 82). Returns their
// ids, for the same-money question on each.
export async function linkEarlierOccurrences(recurringId: string): Promise<DbResult<string[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("link_earlier_occurrences", { p_recurringid: recurringId });
  if (error) {
    return { data: null, error: describeWriteError(error, "goal") };
  }
  return { data: (data ?? []).map((r) => r.transaction_id), error: null };
}

// The recurring TRANSFER id names, if this user owns one (RLS answers
// "owns"), with the goal it feeds; null when it isn't one. The picker only
// offers counted, unlinked ones; this is the server's guard against
// anything else arriving in the form.
export async function getRecurringTransferLink(id: string): Promise<DbResult<{ goalId: string | null } | null>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recurring_transactions")
    .select("id, goalid")
    .eq("id", id)
    .not("to_accountid", "is", null)
    .maybeSingle();
  if (error) {
    return { data: null, error: describeReadError(error, "recurring") };
  }
  return { data: data === null ? null : { goalId: data.goalid }, error: null };
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

/**
 * Each active goal's history pace and what it implies (goal_pace(),
 * migration 72), keyed by goal id. Read-only; every figure is worked out
 * in SQL. A row in an unexpected shape is dropped, so that goal shows no
 * pace line rather than a wrong one.
 */
export async function getGoalPace(): Promise<DbResult<Map<string, GoalPace>>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("goal_pace");
  if (error) {
    return { data: null, error: describeReadError(error, "goals") };
  }
  const byGoal = new Map<string, GoalPace>();
  for (const row of data ?? []) {
    const pace = parseGoalPace(row as Record<string, unknown>);
    if (pace === null) {
      console.error("[goal pace] unexpected goal_pace() row");
      continue;
    }
    byGoal.set(pace.goalId, pace);
  }
  return { data: byGoal, error: null };
}
