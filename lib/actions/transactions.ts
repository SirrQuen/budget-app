"use server";

import { getSameBillPairs } from "@/lib/db/sameBill";
import type { SameBillPair } from "@/lib/sameBill";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createTransaction,
  getTransaction,
  getTransferForEdit,
  updateTransaction,
  updateTransfer,
  deleteTransaction,
  createTransfer,
  deleteTransfer,
  bulkDeleteTransactions,
  getTransactionCount,
  getLatestCreatedAtExcluding,
  suggestCategoryForMerchant,
  balanceAnchorPreview,
  type CreateTransactionInput,
  type CreateTransferInput,
  type TransactionType,
  type MerchantCategorySuggestion,
} from "@/lib/db/transactions";
import { setScheduleAmount } from "@/lib/db/recurring";
import { getSameGoalMoney, replaceContributionWithLink } from "@/lib/db/goals";
import { parseGoalId, type SameMoneyPair } from "@/lib/goalLinks";
import { getSafeToSpend } from "@/lib/db/dashboard";
import { getTimeZone, getToday } from "@/lib/db/settings";
import { isFirstSaveOfDay } from "@/lib/firstToday";
import { logMilestoneCrossedBy } from "@/lib/db/milestones";
import type { MilestoneId } from "@/lib/milestones";
import type { GoalCompletion } from "@/lib/goalCompletion";
import { completedSince, completionSnapshot, type CompletionSnapshot } from "@/lib/goalCompletionCheck";
import { figureUnchangedNote } from "@/lib/whatsAhead";
import { amountChanged, parseEditScope } from "@/lib/recurringEditScope";
import {
  NO_ANCHOR_ANSWER,
  parseAnchorAnswer,
  type AnchorAnswerColumns,
  type AnchorPreview,
} from "@/lib/anchorAnswer";

// "kind" is a plain string, not the icon itself -- Server Action results
// cross the server/client boundary as serialized data, so the client picks
// the icon from this discriminator rather than receiving a React node.
// "streak" covers all four milestones in lib/streak.ts's milestoneReached
// (7/30/100/365) -- the client always shows the same flame regardless of
// which one, so kind doesn't need to carry the day count; message does.
export type Milestone = { kind: "first-transaction" | "streak"; message: string };

export type ActionState =
  | {
      error?: string;
      milestone?: Milestone;
      /**
       * Set only when a save provably leaves safe to spend as it was
       * (figureUnchangedNote, lib/whatsAhead.ts) -- says so, and why.
       */
      note?: string;
      /**
       * Set when a future-dated entry just saved matches a schedule's next
       * occurrence (lib/sameBill.ts): the cheapest moment to ask "Is this
       * the same bill?". Nothing has been linked -- the form asks.
       */
      sameBill?: SameBillPair;
      /**
       * Set when a save that links a transaction to a goal matches a
       * hand-entered contribution to that goal (same_goal_money, migration
       * 69): "Is this the same money?". Nothing has been removed -- the
       * form asks.
       */
      sameMoney?: SameMoneyPair;
      /**
       * True when nothing else was created today (the user's day) before
       * this save: the "First one today" chip. Derived from this response,
       * never stored (docs/Motion-and-Delight.md, step 3).
       */
      firstToday?: true;
      /**
       * A log milestone this save crossed (lib/milestones.ts): the Nth log
       * is one of the rows just created. Derived from this response, never
       * stored; the device decides whether it was already celebrated.
       */
      logMilestone?: { id: MilestoneId; label: string };
      /**
       * A goal this save completed -- a payment that left a followed card
       * owing nothing (migration 70). Only in this response; nothing stored.
       */
      completed?: GoalCompletion;
    }
  | undefined;

// Checked after every successful create. The streak milestone is off: the
// streak counts days with a transaction, so celebrating it on save is a
// direct "log to keep it going" nudge -- it rewards spending. It returns on
// the "opened Sorrel" definition (docs/phase-7-findings.md, "Streak:
// redefined as days opened"), which is why "streak" stays in Milestone.
async function detectTransactionMilestone(): Promise<Milestone | undefined> {
  const countResult = await getTransactionCount();
  if (countResult.data === 1) {
    return { kind: "first-transaction", message: "First transaction logged" };
  }

  return undefined;
}

// The UI already makes an Income/Expense + category mismatch unreachable
// (the category picker only ever offers options for the selected type,
// see AddTransactionForm) -- this just re-validates the same shape server
// side, since a Server Action is a public endpoint regardless of what the
// form in front of it allows.
function parseTransactionFields(formData: FormData): CreateTransactionInput | { error: string } {
  const transaction_date = String(formData.get("transaction_date") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const transaction_type = String(formData.get("transaction_type") ?? "");
  const categoryid = String(formData.get("categoryid") ?? "");
  const accountid = String(formData.get("accountid") ?? "");
  const merchant = String(formData.get("merchant") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const payment_method = String(formData.get("payment_method") ?? "").trim();

  if (!transaction_date || Number.isNaN(Date.parse(transaction_date))) {
    return { error: "Enter a valid date." };
  }
  if (!description) {
    return { error: "Description is required." };
  }

  const amount = Number(amountRaw);
  // transactions.amount is CHECK (amount >= 0), but a $0 row isn't a real
  // transaction -- direction comes from transaction_type, never a sign, so
  // this requires strictly positive rather than just non-negative.
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter an amount greater than zero." };
  }
  if (transaction_type !== "Income" && transaction_type !== "Expense") {
    return { error: "Choose Income or Expense." };
  }
  if (!categoryid) {
    return { error: "Choose a category." };
  }
  if (!accountid) {
    return { error: "Choose an account." };
  }

  return {
    transaction_date,
    description,
    amount,
    transaction_type: transaction_type as TransactionType,
    categoryid,
    accountid,
    merchant: merchant || null,
    notes: notes || null,
    payment_method: payment_method || null,
    // The goal (migration 69). Always present, so an edit that clears it
    // clears it; null for income, which the database refuses to link.
    goalid: parseGoalId(formData.get("goalid"), transaction_type as TransactionType),
    // The pre-anchor answer, only when the form asked (migration 62).
    // Omitted otherwise, so an edit that didn't ask -- a new description
    // on an old charge -- leaves the stored answer exactly as it was.
    // Whether one was needed is the database's call; it refuses a missing one.
    ...answerIfGiven(parseAnchorAnswer(formData, accountid)),
  };
}

function answerIfGiven(answer: AnchorAnswerColumns): Partial<AnchorAnswerColumns> {
  return answer.counts_despite_anchor === null ? {} : answer;
}

// Mirrors parseTransactionFields -- the "From and to must differ" check is
// already unreachable from AddTransactionForm's inline validation, but this
// is a public endpoint regardless of what the form in front of it allows.
function parseTransferFields(formData: FormData): CreateTransferInput | { error: string } {
  const transaction_date = String(formData.get("transaction_date") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const fromAccountId = String(formData.get("fromAccountId") ?? "");
  const toAccountId = String(formData.get("toAccountId") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();

  if (!transaction_date || Number.isNaN(Date.parse(transaction_date))) {
    return { error: "Enter a valid date." };
  }
  if (!description) {
    return { error: "Description is required." };
  }

  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter an amount greater than zero." };
  }
  if (!fromAccountId) {
    return { error: "Choose a from account." };
  }
  if (!toAccountId) {
    return { error: "Choose a to account." };
  }
  if (fromAccountId === toAccountId) {
    return { error: "From and to accounts must be different." };
  }

  return {
    fromAccountId,
    toAccountId,
    amount,
    date: transaction_date,
    description,
    notes: notes || null,
    goalid: parseGoalId(formData.get("goalid"), "Transfer"),
    fromAnchorAnswer: parseAnchorAnswer(formData, fromAccountId),
    toAnchorAnswer: parseAnchorAnswer(formData, toAccountId),
  };
}

// Shared by both branches of createTransactionAction -- revalidate, then
// check for a milestone on whatever just got created.
type SavedRow = { id: string; transaction_date: string; goalid: string | null };

async function afterTransactionCreated(saved: SavedRow[], before: CompletionSnapshot): Promise<ActionState> {
  revalidatePath("/transactions");
  if (saved.some((r) => r.goalid !== null)) revalidateGoals();
  // Every create can move an account balance (a transfer always moves two)
  // -- "Make a payment" opens straight from /accounts, so that page needs to
  // reflect it without a manual refresh.
  revalidatePath("/accounts");
  const [milestone, note] = await Promise.all([detectTransactionMilestone(), figureNote(saved)]);
  // After figureNote: both read the same cache()d schedules and future rows.
  const [sameBill, sameMoney] = await Promise.all([sameBillAfterSave(saved), sameMoneyAfterSave(saved)]);
  const [firstToday, completed, logMilestone] = await Promise.all([
    firstSaveToday(saved),
    completedSince(before),
    logMilestoneCrossedBy(saved.map((r) => r.id)),
  ]);
  if (!milestone && !note && !sameBill && !sameMoney && !firstToday && !completed && !logMilestone) return undefined;
  return {
    ...(logMilestone ? { logMilestone } : {}),
    ...(completed ? { completed } : {}),
    ...(firstToday ? { firstToday: true as const } : {}),
    ...(milestone ? { milestone } : {}),
    ...(note ? { note } : {}),
    ...(sameBill ? { sameBill } : {}),
    ...(sameMoney ? { sameMoney } : {}),
  };
}

// Was anything else created today, in the user's zone, before this save?
// A read after the write -- the save has already succeeded, so a failure is
// silence (no chip), never an error.
async function firstSaveToday(saved: { id: string }[]): Promise<boolean> {
  try {
    const [today, timeZone] = await Promise.all([getToday(), getTimeZone()]);
    const latest = await getLatestCreatedAtExcluding(saved.map((r) => r.id));
    if (latest.error !== null) return false;
    return isFirstSaveOfDay(latest.data, today, timeZone);
  } catch {
    return false;
  }
}

// A goal's progress and its monthly hold (safe to spend) both read linked
// transactions (v_goal_money, migration 69).
function revalidateGoals() {
  revalidatePath("/goals");
  revalidatePath("/dashboard");
}

// "Is this the same money?" (migration 69): the saved row that carries a
// goal (a transfer's Expense leg) against hand entries to that goal. The
// save has already succeeded: a failure here is silence, never an error.
async function sameMoneyAfterSave(saved: SavedRow[]): Promise<SameMoneyPair | undefined> {
  const linked = saved.find((r) => r.goalid !== null);
  if (!linked) return undefined;
  try {
    const result = await getSameGoalMoney(linked.id);
    return result.data ?? undefined;
  } catch {
    return undefined;
  }
}

// "Is this the same bill?" at entry time (migration 66). Only a row dated
// after today can pair with an occurrence. The save has already succeeded:
// a failure here is silence -- Upcoming still asks.
async function sameBillAfterSave(saved: { id: string; transaction_date: string }[]): Promise<SameBillPair | undefined> {
  try {
    const today = await getToday();
    if (!saved.some((r) => r.transaction_date > today)) return undefined;
    const pairs = await getSameBillPairs();
    if (pairs.error !== null) return undefined;
    const ids = new Set(saved.map((r) => r.id));
    return pairs.data.find((p) => ids.has(p.transactionId));
  } catch {
    return undefined;
  }
}

// docs/Safe-to-Spend-Why.md, "After a save". Only a row dated after today
// can sit past the tightest day, so only those pay for a projection -- one
// getSafeToSpend(), the same reads as a dashboard load. The save has
// already succeeded: any failure here is silence, never an error.
async function figureNote(saved: { id: string; transaction_date: string }[]): Promise<string | undefined> {
  try {
    const today = await getToday();
    if (!saved.some((r) => r.transaction_date > today)) return undefined;
    const result = await getSafeToSpend();
    if (result.error || !result.data) return undefined;
    return figureUnchangedNote(result.data, saved.map((r) => r.id)) ?? undefined;
  } catch {
    return undefined;
  }
}

// Called directly as a function from the quick-add bar (not through
// useActionState) -- it's a lookup for the inline preview, not a mutation.
export async function suggestCategoryAction(
  merchant: string,
  transactionType: TransactionType,
): Promise<MerchantCategorySuggestion | null> {
  const result = await suggestCategoryForMerchant(merchant, transactionType);
  return result.data;
}

// Also a lookup, not a mutation: the pre-anchor question (migration 62)
// asks this whenever the account or date changes. null when it can't be
// answered -- the form then shows no question, and if one was needed the
// database refuses the save and says so.
export async function balanceAnchorAction(
  accountId: string,
  transactionDate: string,
  transactionId: string | null,
): Promise<AnchorPreview | null> {
  if (!accountId || !/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) {
    return null;
  }
  const result = await balanceAnchorPreview(accountId, transactionDate, transactionId);
  return result.data;
}

export async function createTransactionAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Sent by both create forms (QuickAddBar, AddTransactionForm). Retrying
  // with the same key must resolve to what the first attempt created, not a
  // second copy -- see the 23505 handling in createTransaction and
  // createTransfer.
  const idempotencyKey = String(formData.get("idempotency_key") ?? "").trim() || null;

  // The type toggle's third option -- Transfer -- shares this action rather
  // than getting its own, since AddTransactionForm's useActionState binds a
  // single action for the life of the form.
  if (formData.get("transaction_type") === "Transfer") {
    const parsed = parseTransferFields(formData);
    if ("error" in parsed) {
      return parsed;
    }

    const before = await completionSnapshot();
    const { data: legs, error } = await createTransfer({ ...parsed, idempotency_key: idempotencyKey });
    if (error) {
      return { error };
    }

    return afterTransactionCreated(legs ?? [], before);
  }

  const parsed = parseTransactionFields(formData);
  if ("error" in parsed) {
    return parsed;
  }

  const before = await completionSnapshot();
  const { data: row, error } = await createTransaction({
    ...parsed,
    idempotency_key: idempotencyKey,
  });

  if (error) {
    return { error };
  }

  return afterTransactionCreated(row ? [row] : [], before);
}

export async function updateTransactionAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) {
    return { error: "Missing transaction id." };
  }

  // Read first, server-side: whether this row is a transfer leg, and which
  // schedule it came from, are the database's facts, never the form's.
  const existing = await getTransaction(id);
  if (existing.error !== null) {
    return { error: existing.error };
  }
  if (existing.data === null) {
    return { error: "That transaction isn't there anymore." };
  }
  // A transfer is one thing with two legs. Editing one leg alone would
  // leave a pair that doesn't net to zero, so legs are only ever written
  // through updateTransferAction -> update_transfer(). The database refuses
  // it too (trg_transactions_transfer_pair, migration 59).
  if (existing.data.transfer_group_id !== null) {
    return { error: "This is part of a transfer. Edit the transfer instead." };
  }

  const parsed = parseTransactionFields(formData);
  if ("error" in parsed) {
    return parsed;
  }

  // No updated_at here -- set_updated_at handles it at the DB layer.
  // Nor is_estimated: trg_transactions_amount_supplied (migration 58)
  // clears it when the amount changes, and only then -- resaving an
  // estimated row with its amount untouched doesn't make the amount a
  // person's (CLAUDE.md "is_estimated").
  const { error } = await updateTransaction(id, parsed);

  if (error) {
    return { error };
  }
  const goalChanged = (parsed.goalid ?? null) !== existing.data.goalid;
  const goalMoneyMoved =
    goalChanged || (existing.data.goalid !== null && amountChanged(Number(existing.data.amount), parsed.amount ?? 0));
  if (goalMoneyMoved) revalidateGoals();

  // "This and future occurrences": asked only for a confirmed recurring
  // transaction whose amount changed (lib/recurringEditScope.ts). Never
  // silent -- the form always shows the choice.
  const recurringid = existing.data.recurringid;
  const before = Number(existing.data.amount);
  const after = parsed.amount ?? before;
  if (
    recurringid !== null &&
    amountChanged(before, after) &&
    parseEditScope(formData.get("edit_scope")) === "future"
  ) {
    const scheduleResult = await setScheduleAmount(recurringid, after);
    if (scheduleResult.error !== null) {
      revalidatePath("/transactions");
      revalidatePath("/accounts");
      return { error: `Saved the transaction, but the schedule wasn't updated: ${scheduleResult.error}` };
    }
    revalidatePath("/recurring");
    revalidatePath("/dashboard");
  }

  revalidatePath("/transactions");
  // An edit can change the amount, type, or account -- any of which moves a
  // balance.
  revalidatePath("/accounts");
  // An edit that links a goal asks "Is this the same money?" before
  // leaving, so it answers here rather than redirecting.
  if (goalChanged && parsed.goalid) {
    const sameMoney = await sameMoneyAfterSave([{ id, transaction_date: parsed.transaction_date ?? "", goalid: parsed.goalid }]);
    if (sameMoney) return { sameMoney };
  }
  redirect("/transactions");
}

// Editing an existing transfer: both legs, one call, update_transfer()
// (migration 59). From, to, amount, date, description and notes; swapping
// from and to swaps the direction. A transfer confirmed from a schedule
// gets the same scope question as any recurring transaction.
export async function updateTransferAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const transferGroupId = String(formData.get("transfer_group_id") ?? "");
  if (!UUID_RE.test(transferGroupId)) {
    return { error: "Missing transfer." };
  }

  const parsed = parseTransferFields(formData);
  if ("error" in parsed) {
    return parsed;
  }

  // The scope applies only when the amount changed; the stored amount is
  // read here, not taken from the form.
  const existing = await getTransferForEdit(transferGroupId);
  if (existing.error !== null) {
    return { error: existing.error };
  }
  if (existing.data === null) {
    return { error: "That transfer isn't there anymore." };
  }
  const updateSchedule =
    existing.data.schedule !== null &&
    amountChanged(existing.data.amount, parsed.amount) &&
    parseEditScope(formData.get("edit_scope")) === "future";

  const { error } = await updateTransfer({
    transferGroupId,
    fromAccountId: parsed.fromAccountId,
    toAccountId: parsed.toAccountId,
    amount: parsed.amount,
    date: parsed.date,
    description: parsed.description,
    notes: parsed.notes ?? null,
    updateSchedule,
    fromAnchorAnswer: parsed.fromAnchorAnswer ?? NO_ANCHOR_ANSWER,
    toAnchorAnswer: parsed.toAnchorAnswer ?? NO_ANCHOR_ANSWER,
    goalid: parsed.goalid ?? null,
  });
  if (error) {
    return { error };
  }
  const goalChanged = (parsed.goalid ?? null) !== existing.data.goalid;
  if (goalChanged || existing.data.goalid !== null) revalidateGoals();

  // A transfer touches two balances, and can move safe to spend when an
  // account crosses the spendable set.
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  if (updateSchedule) revalidatePath("/recurring");
  if (goalChanged && parsed.goalid) {
    const sameMoney = await sameMoneyAfterSave([
      { id: existing.data.fromLeg.id, transaction_date: parsed.date, goalid: parsed.goalid },
    ]);
    if (sameMoney) return { sameMoney };
  }
  redirect("/transactions");
}

// "Yes, it's the same money": the linked transaction replaces the hand
// entry (replace_contribution_with_link, migration 69). Called directly
// from the question, never automatically.
export async function replaceContributionWithLinkAction(
  transactionId: string,
  contributionId: string,
): Promise<ActionState> {
  if (!UUID_RE.test(transactionId) || !UUID_RE.test(contributionId)) {
    return { error: "Missing contribution." };
  }
  const { error } = await replaceContributionWithLink(transactionId, contributionId);
  if (error) {
    return { error };
  }
  revalidateGoals();
  return undefined;
}

// Hard delete -- nothing references a transaction row, unlike accounts and
// categories (ON DELETE RESTRICT from their side). redirectToList is explicit
// rather than inferred, since a Server Action's redirect() defaults to a
// history-stack push: the edit page needs it (there's nothing left to show
// once the row is gone), a list row doesn't (revalidatePath alone drops the
// row from the list already on screen, and pushing a redundant /transactions
// entry there would just pollute back-button history).
export async function deleteTransactionAction(
  id: string,
  redirectToList: boolean,
): Promise<ActionState> {
  if (!id) {
    return { error: "Missing transaction id." };
  }

  const { error } = await deleteTransaction(id);

  if (error) {
    return { error };
  }

  revalidatePath("/transactions");
  // A linked row takes its goal money with it (migration 69).
  revalidateGoals();
  // Removing a transaction moves whatever balance it was part of.
  revalidatePath("/accounts");

  if (redirectToList) {
    redirect("/transactions");
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The list's selection bar sends whatever ids the client rendered checkboxes
// for -- a public endpoint regardless of what the UI allows, so ids that
// aren't well-formed UUIDs are dropped rather than handed to the DB layer's
// raw filter string.
export async function bulkDeleteTransactionsAction(
  transactionIds: string[],
  transferGroupIds: string[],
): Promise<ActionState> {
  const ids = transactionIds.filter((id) => UUID_RE.test(id));
  const groupIds = transferGroupIds.filter((id) => UUID_RE.test(id));

  if (ids.length === 0 && groupIds.length === 0) {
    return { error: "Nothing selected." };
  }

  const { error } = await bulkDeleteTransactions(ids, groupIds);
  if (error) {
    return { error };
  }

  revalidatePath("/transactions");
  revalidateGoals();
  // A bulk delete can touch several accounts' balances at once.
  revalidatePath("/accounts");
}

// A transfer is two rows sharing transfer_group_id -- deleteTransfer removes
// both in one statement. Never route a transfer leg's id through
// deleteTransactionAction, or the other leg is orphaned.
export async function deleteTransferAction(
  transferGroupId: string,
  redirectToList: boolean,
): Promise<ActionState> {
  if (!transferGroupId) {
    return { error: "Missing transfer group id." };
  }

  const { error } = await deleteTransfer(transferGroupId);

  if (error) {
    return { error };
  }

  revalidatePath("/transactions");
  revalidateGoals();
  // A transfer touches two balances -- both need to drop the removed amount.
  revalidatePath("/accounts");

  if (redirectToList) {
    redirect("/transactions");
  }
}
