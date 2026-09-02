import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { isLiabilityAccountType, type AccountType } from "@/lib/accountOptions";
import { describeReadError, describeWriteError } from "@/lib/db/errors";

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
    return { data: null, error: describeReadError(error, "accounts") };
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
    return { data: null, error: describeReadError(error, "account") };
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
    return {
      data: null,
      error: "Your session's expired. Log in again to pick up where you left off.",
    };
  }

  const { data, error } = await supabase
    .from("accounts")
    .insert({ ...input, userid })
    .select()
    .single();

  if (error) {
    return { data: null, error: describeWriteError(error, "account") };
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
    return { data: null, error: describeWriteError(error, "account") };
  }

  return { data, error: null };
}

// Accounts are soft-deleted only. transactions.accountid is
// ON DELETE RESTRICT, so a hard delete of a used account fails at the
// database anyway -- this is the only supported way to retire one.
export async function archiveAccount(id: string): Promise<DbResult<AccountRow>> {
  return updateAccount(id, { is_active: false });
}

// The default "From" account for a credit-card/loan payment transfer --
// whichever active asset account (everything but Credit Card/Loan) shows up
// on the most transactions. Falls back to the first asset account by name
// when there's no usage history yet to rank by (a brand-new account, or one
// that's never been spent from).
export async function getMostUsedAssetAccountId(): Promise<DbResult<string | null>> {
  const supabase = await createClient();

  const { data: accounts, error: accountsError } = await supabase
    .from("accounts")
    .select("id, account_type")
    .eq("is_active", true)
    .order("account_name", { ascending: true });

  if (accountsError) {
    return { data: null, error: describeReadError(accountsError, "accounts") };
  }

  const assetAccountIds = accounts
    .filter((a) => !isLiabilityAccountType(a.account_type))
    .map((a) => a.id);

  if (assetAccountIds.length === 0) {
    return { data: null, error: null };
  }

  const { data: legs, error: legsError } = await supabase
    .from("transactions")
    .select("accountid")
    .in("accountid", assetAccountIds);

  if (legsError) {
    return { data: null, error: describeReadError(legsError, "accounts") };
  }

  const counts = new Map<string, number>();
  for (const leg of legs) {
    counts.set(leg.accountid, (counts.get(leg.accountid) ?? 0) + 1);
  }

  // assetAccountIds is already ordered by account_name -- iterating it in
  // that order, rather than the counts map, means a tie (including the
  // all-zero case) resolves to the alphabetically-first account.
  let best = assetAccountIds[0];
  let bestCount = -1;
  for (const id of assetAccountIds) {
    const count = counts.get(id) ?? 0;
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }

  return { data: best, error: null };
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
    return { data: null, error: describeReadError(error, "accounts") };
  }

  return { data, error: null };
}
