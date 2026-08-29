"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  createTransfer,
  deleteTransfer,
  bulkDeleteTransactions,
  getTransactionCount,
  suggestCategoryForMerchant,
  type CreateTransactionInput,
  type CreateTransferInput,
  type TransactionType,
  type MerchantCategorySuggestion,
} from "@/lib/db/transactions";
import { getLoggingStreak } from "@/lib/db/dashboard";

// "kind" is a plain string, not the icon itself -- Server Action results
// cross the server/client boundary as serialized data, so the client picks
// the icon from this discriminator rather than receiving a React node.
export type Milestone = { kind: "first-transaction" | "streak-7"; message: string };

export type ActionState = { error?: string; milestone?: Milestone } | undefined;

// Checked after every successful create, in priority order -- a first-ever
// transaction can't also be a 7-day streak, so there's no real conflict, but
// the order still reads as "most foundational achievement first."
async function detectTransactionMilestone(): Promise<Milestone | undefined> {
  const countResult = await getTransactionCount();
  if (countResult.data === 1) {
    return { kind: "first-transaction", message: "First transaction logged" };
  }

  const streakResult = await getLoggingStreak();
  if (streakResult.data?.current === 7) {
    return { kind: "streak-7", message: "7-day streak" };
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
  };
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
  };
}

// Shared by both branches of createTransactionAction -- revalidate, then
// check for a milestone on whatever just got created.
async function afterTransactionCreated(): Promise<ActionState> {
  revalidatePath("/transactions");
  // Every create can move an account balance (a transfer always moves two)
  // -- "Make a payment" opens straight from /accounts, so that page needs to
  // reflect it without a manual refresh.
  revalidatePath("/accounts");
  const milestone = await detectTransactionMilestone();
  return milestone ? { milestone } : undefined;
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

export async function createTransactionAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // The type toggle's third option -- Transfer -- shares this action rather
  // than getting its own, since AddTransactionForm's useActionState binds a
  // single action for the life of the form.
  if (formData.get("transaction_type") === "Transfer") {
    const parsed = parseTransferFields(formData);
    if ("error" in parsed) {
      return parsed;
    }

    const { error } = await createTransfer(parsed);
    if (error) {
      return { error };
    }

    return afterTransactionCreated();
  }

  const parsed = parseTransactionFields(formData);
  if ("error" in parsed) {
    return parsed;
  }

  // Optional: only quick-add sends this. Retrying with the same key must
  // resolve to the row the first attempt created, not a second one -- see
  // createTransaction's 23505 handling.
  const idempotencyKey = String(formData.get("idempotency_key") ?? "").trim();

  const { error } = await createTransaction({
    ...parsed,
    idempotency_key: idempotencyKey || null,
  });

  if (error) {
    return { error };
  }

  return afterTransactionCreated();
}

export async function updateTransactionAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) {
    return { error: "Missing transaction id." };
  }

  const parsed = parseTransactionFields(formData);
  if ("error" in parsed) {
    return parsed;
  }

  // No updated_at here -- set_updated_at handles it at the DB layer.
  const { error } = await updateTransaction(id, parsed);

  if (error) {
    return { error };
  }

  revalidatePath("/transactions");
  // An edit can change the amount, type, or account -- any of which moves a
  // balance.
  revalidatePath("/accounts");
  redirect("/transactions");
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
  // A transfer touches two balances -- both need to drop the removed amount.
  revalidatePath("/accounts");

  if (redirectToList) {
    redirect("/transactions");
  }
}
