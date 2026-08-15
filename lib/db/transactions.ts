import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"];
type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type TransactionUpdate = Database["public"]["Tables"]["transactions"]["Update"];

export type TransactionType = "Income" | "Expense";

export type TransactionWithRelations = TransactionRow & {
  category_name: string | null;
  account_name: string | null;
};

export type DbResult<T> = { data: T; error: null } | { data: null; error: string };

export type ListTransactionsOptions = {
  dateFrom?: string;
  dateTo?: string;
  categoryid?: string;
  accountid?: string;
  transaction_type?: TransactionType;
};

// categoryid has FK relationships to several relations (categories, plus a
// couple of reporting views) -- naming "categories"/"accounts" explicitly
// picks the base-table relationship, not the views.
const TRANSACTION_SELECT =
  "*, category:categories(category_name), account:accounts(account_name)";

type RawTransactionRow = TransactionRow & {
  category: { category_name: string } | null;
  account: { account_name: string } | null;
};

function flatten(row: RawTransactionRow): TransactionWithRelations {
  const { category, account, ...rest } = row;
  return {
    ...rest,
    category_name: category?.category_name ?? null,
    account_name: account?.account_name ?? null,
  };
}

export async function listTransactions(
  opts: ListTransactionsOptions = {},
): Promise<DbResult<TransactionWithRelations[]>> {
  const supabase = await createClient();

  let query = supabase
    .from("transactions")
    .select(TRANSACTION_SELECT)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (opts.dateFrom) {
    query = query.gte("transaction_date", opts.dateFrom);
  }
  if (opts.dateTo) {
    query = query.lte("transaction_date", opts.dateTo);
  }
  if (opts.categoryid) {
    query = query.eq("categoryid", opts.categoryid);
  }
  if (opts.accountid) {
    query = query.eq("accountid", opts.accountid);
  }
  if (opts.transaction_type) {
    query = query.eq("transaction_type", opts.transaction_type);
  }

  const { data, error } = await query.returns<RawTransactionRow[]>();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data.map(flatten), error: null };
}

export async function getTransaction(
  id: string,
): Promise<DbResult<TransactionWithRelations>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("transactions")
    .select(TRANSACTION_SELECT)
    .eq("id", id)
    .single()
    .returns<RawTransactionRow>();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: flatten(data), error: null };
}

export type CreateTransactionInput = Omit<
  TransactionInsert,
  "userid" | "id" | "created_at" | "updated_at"
> & {
  categoryid: string;
  transaction_type: TransactionType;
};

export async function createTransaction(
  input: CreateTransactionInput,
): Promise<DbResult<TransactionRow>> {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userid = claimsData?.claims?.sub;

  if (claimsError || !userid) {
    return { data: null, error: "No authenticated user session." };
  }

  // Pre-check so a mismatched category/type pair gets a readable error
  // instead of the DB trigger's raw errcode 23514 exception. The trigger
  // (enforce_category_type) still enforces this at the DB layer regardless.
  const { data: category, error: categoryError } = await supabase
    .from("categories")
    .select("category_type")
    .eq("id", input.categoryid)
    .single();

  if (categoryError) {
    return { data: null, error: categoryError.message };
  }

  if (category.category_type !== input.transaction_type) {
    return {
      data: null,
      error: `Category is ${category.category_type} but transaction is ${input.transaction_type}.`,
    };
  }

  const { data, error } = await supabase
    .from("transactions")
    .insert({ ...input, userid })
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export type UpdateTransactionPatch = Omit<
  TransactionUpdate,
  "id" | "userid" | "created_at" | "updated_at"
>;

export async function updateTransaction(
  id: string,
  patch: UpdateTransactionPatch,
): Promise<DbResult<TransactionRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("transactions")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export async function deleteTransaction(id: string): Promise<DbResult<{ id: string }>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("transactions")
    .delete()
    .eq("id", id)
    .select("id")
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}
