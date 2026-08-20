"use server";

import { revalidatePath } from "next/cache";
import {
  createAccount,
  updateAccount,
  archiveAccount,
  ACCOUNT_TYPES,
  type AccountType,
} from "@/lib/db/accounts";

export type ActionState = { error?: string } | undefined;

const VALID_TYPES = new Set<AccountType>(ACCOUNT_TYPES);

type ParsedAccountFields = {
  account_name: string;
  account_type: AccountType;
  institution: string | null;
  opening_balance: number;
};

// Shared by create and update -- both forms offer the exact same fields.
function parseAccountFields(formData: FormData): ParsedAccountFields | { error: string } {
  const account_name = String(formData.get("account_name") ?? "").trim();
  const account_type = String(formData.get("account_type") ?? "");
  const institution = String(formData.get("institution") ?? "").trim();
  const opening_balance_raw = String(formData.get("opening_balance") ?? "").trim();

  if (!account_name) {
    return { error: "Account name is required." };
  }
  if (!VALID_TYPES.has(account_type as AccountType)) {
    return { error: "Choose an account type." };
  }

  const opening_balance = opening_balance_raw === "" ? 0 : Number(opening_balance_raw);
  if (!Number.isFinite(opening_balance)) {
    return { error: "Starting balance must be a number." };
  }

  return {
    account_name,
    account_type: account_type as AccountType,
    institution: institution || null,
    opening_balance,
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
