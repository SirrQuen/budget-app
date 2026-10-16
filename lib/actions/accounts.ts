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
};

// The balance anchor: the figure and the date it was true on.
// Re-setting it is its own act -- the database stamps opening_set_at
// whenever an update names either column (migration 48), and that time
// decides which same-day transactions count. So an update carries these
// only when the form posted them, which it does only once the user edits
// the balance, its date, or a type change that flips the sign.
type ParsedAnchor = {
  opening_balance: number;
  opening_date: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Shared by create and update -- both forms offer the exact same fields.
function parseAccountFields(formData: FormData): ParsedAccountFields | { error: string } {
  const account_name = String(formData.get("account_name") ?? "").trim();
  const account_type = String(formData.get("account_type") ?? "");
  const institution = String(formData.get("institution") ?? "").trim();

  if (!account_name) {
    return { error: "Account name is required." };
  }
  if (!VALID_TYPES.has(account_type as AccountType)) {
    return { error: "Choose an account type." };
  }

  return {
    account_name,
    account_type: account_type as AccountType,
    institution: institution || null,
  };
}

// null when the form didn't post the anchor (an edit that left it alone).
function parseAnchor(
  formData: FormData,
  account_type: AccountType,
): ParsedAnchor | null | { error: string } {
  if (!formData.has("opening_date") && !formData.has("opening_balance")) {
    return null;
  }

  const opening_balance_raw = String(formData.get("opening_balance") ?? "").trim();
  const opening_date = String(formData.get("opening_date") ?? "").trim();

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

  return { opening_balance, opening_date };
}

export async function createAccountAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseAccountFields(formData);
  if ("error" in parsed) {
    return parsed;
  }
  const anchor = parseAnchor(formData, parsed.account_type);
  if (anchor === null) {
    return { error: "Choose the date this balance is as of." };
  }
  if ("error" in anchor) {
    return anchor;
  }

  const { error } = await createAccount({ ...parsed, ...anchor });

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
  const anchor = parseAnchor(formData, parsed.account_type);
  if (anchor !== null && "error" in anchor) {
    return anchor;
  }

  const { error } = await updateAccount(id, anchor === null ? parsed : { ...parsed, ...anchor });

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
