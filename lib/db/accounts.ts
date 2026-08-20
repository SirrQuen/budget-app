import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import type { AccountType } from "@/lib/accountOptions";

export { ACCOUNT_TYPES, type AccountType } from "@/lib/accountOptions";

type AccountRow = Database["public"]["Tables"]["accounts"]["Row"];
type AccountInsert = Database["public"]["Tables"]["accounts"]["Insert"];
type AccountUpdate = Database["public"]["Tables"]["accounts"]["Update"];
type AccountBalanceRow = Database["public"]["Views"]["v_account_balances"]["Row"];

export type DbResult<T> = { data: T; error: null } | { data: null; error: string };

export type ListAccountsOptions = {
  is_active?: boolean;
};

export async function listAccounts(
  opts: ListAccountsOptions = {},
): Promise<DbResult<AccountRow[]>> {
  const supabase = await createClient();

  let query = supabase
    .from("accounts")
    .select("*")
    .order("account_name", { ascending: true });

  if (opts.is_active !== undefined) {
    query = query.eq("is_active", opts.is_active);
  }

  const { data, error } = await query;

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export async function getAccount(id: string): Promise<DbResult<AccountRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export type CreateAccountInput = Omit<
  AccountInsert,
  "userid" | "id" | "created_at" | "updated_at"
> & {
  account_type: AccountType;
};

export async function createAccount(
  input: CreateAccountInput,
): Promise<DbResult<AccountRow>> {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userid = claimsData?.claims?.sub;

  if (claimsError || !userid) {
    return { data: null, error: "No authenticated user session." };
  }

  const { data, error } = await supabase
    .from("accounts")
    .insert({ ...input, userid })
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export type UpdateAccountPatch = Omit<
  AccountUpdate,
  "id" | "userid" | "created_at" | "updated_at"
>;

export async function updateAccount(
  id: string,
  patch: UpdateAccountPatch,
): Promise<DbResult<AccountRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("accounts")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

// Accounts are soft-deleted only. transactions.accountid is
// ON DELETE RESTRICT, so a hard delete of a used account fails at the
// database anyway -- this is the only supported way to retire one.
export async function archiveAccount(id: string): Promise<DbResult<AccountRow>> {
  return updateAccount(id, { is_active: false });
}

export type ListAccountBalancesOptions = {
  is_active?: boolean;
};

// Balances are computed (opening_balance + net of transactions), never
// stored -- read from the view instead of summing transactions in JS.
export async function listAccountBalances(
  opts: ListAccountBalancesOptions = {},
): Promise<DbResult<AccountBalanceRow[]>> {
  const supabase = await createClient();

  let query = supabase
    .from("v_account_balances")
    .select("*")
    .order("account_name", { ascending: true });

  if (opts.is_active !== undefined) {
    query = query.eq("is_active", opts.is_active);
  }

  const { data, error } = await query;

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}
