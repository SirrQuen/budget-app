"use server";

import { revalidatePath } from "next/cache";
import {
  createAccount,
  updateAccount,
  archiveAccount,
  ACCOUNT_TYPES,
  type AccountType,
} from "@/lib/db/accounts";
import { isLiabilityAccountType } from "@/lib/accountOptions";

export type ActionState = { error?: string } | undefined;

const VALID_TYPES = new Set<AccountType>(ACCOUNT_TYPES);

type ParsedAccountFields = {
  account_name: string;
  account_type: AccountType;
  institution: string | null;
  opening_balance: number;
  opening_date: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Shared by create and update -- both forms offer the exact same fields.
function parseAccountFields(formData: FormData): ParsedAccountFields | { error: string } {
  const account_name = String(formData.get("account_name") ?? "").trim();
  const account_type = String(formData.get("account_type") ?? "");
  const institution = String(formData.get("institution") ?? "").trim();
  const opening_balance_raw = String(formData.get("opening_balance") ?? "").trim();
  const opening_date = String(formData.get("opening_date") ?? "").trim();

  if (!account_name) {
    return { error: "Account name is required." };
  }
  if (!VALID_TYPES.has(account_type as AccountType)) {
    return { error: "Choose an account type." };
  }
  if (!ISO_DATE.test(opening_date)) {
    return { error: "Choose the date this balance is as of." };
  }

  let opening_balance = opening_balance_raw === "" ? 0 : Number(opening_balance_raw);
  if (!Number.isFinite(opening_balance)) {
    return { error: "Balance must be a number." };
  }

  // Credit Card and Loan balances are stored negative (accounts_liability_sign).
  // The form collects "how much do you owe" as a positive number and this is
  // the one place that flips its sign for storage.
  if (isLiabilityAccountType(account_type)) {
    if (opening_balance < 0) {
      return { error: "Enter what you owe as a positive number." };
    }
    opening_balance = -opening_balance;
  }

  return {
    account_name,
    account_type: account_type as AccountType,
    institution: institution || null,
    opening_balance,
    opening_date,
  };
}

export async function createAccountAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseAccountFields(formData);
  if ("error" in parsed) {
    return parsed;
  }

  const { error } = await createAccount(parsed);

  if (error) {
    return { error };
  }

  revalidatePath("/accounts");
}

export async function updateAccountAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) {
    return { error: "Missing account id." };
  }

  const parsed = parseAccountFields(formData);
  if ("error" in parsed) {
    return parsed;
  }

  const { error } = await updateAccount(id, parsed);

  if (error) {
    return { error };
  }

  revalidatePath("/accounts");
}

// Called from the transaction form's "move the balance date back" note --
// a transaction dated before an account's opening_date doesn't touch that
// account's balance, so this is the fix offered right where the user
// notices it, rather than a trip to the account's edit form.
export async function updateAccountOpeningDateAction(
  accountId: string,
  openingDate: string,
): Promise<ActionState> {
  if (!accountId) {
    return { error: "Missing account id." };
  }
  if (!ISO_DATE.test(openingDate)) {
    return { error: "Invalid date." };
  }

  const { error } = await updateAccount(accountId, { opening_date: openingDate });

  if (error) {
    return { error };
  }

  revalidatePath("/accounts");
}

// Archives, never deletes -- transactions.accountid is ON DELETE RESTRICT,
// so a hard delete of a used account fails at the database anyway. Callers
// should label this "Archive" in the UI, never "Delete", since past
// transactions keep referencing the account and its history survives.
export async function archiveAccountAction(id: string): Promise<ActionState> {
  if (!id) {
    return { error: "Missing account id." };
  }

  const { error } = await archiveAccount(id);

  if (error) {
    return { error };
  }

  revalidatePath("/accounts");
}
