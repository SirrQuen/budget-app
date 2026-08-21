"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  getTransactionCount,
  type CreateTransactionInput,
  type TransactionType,
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

export async function createTransactionAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseTransactionFields(formData);
  if ("error" in parsed) {
    return parsed;
  }

  const { error } = await createTransaction(parsed);

  if (error) {
    return { error };
  }

  revalidatePath("/transactions");

  const milestone = await detectTransactionMilestone();
  return milestone ? { milestone } : undefined;
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

  if (redirectToList) {
    redirect("/transactions");
  }
}
