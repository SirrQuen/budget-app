import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"];
type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type TransactionUpdate = Database["public"]["Tables"]["transactions"]["Update"];

export type TransactionType = "Income" | "Expense";

export type TransactionWithRelations = TransactionRow & {
  category_name: string | null;
  category_color: string | null;
  account_name: string | null;
};

export type DbResult<T> = { data: T; error: null } | { data: null; error: string };

export const TRANSACTIONS_PAGE_SIZE = 50;

export type ListTransactionsOptions = {
  dateFrom?: string;
  dateTo?: string;
  categoryid?: string;
  accountid?: string;
  transaction_type?: TransactionType;
  /** Only rows that belong to a transfer group. */
  transfersOnly?: boolean;
  /** Only rows that don't belong to a transfer group. */
  excludeTransfers?: boolean;
  /** 1-indexed. Defaults to 1. */
  page?: number;
};

export type TransactionsPage = {
  transactions: TransactionWithRelations[];
  totalCount: number;
};

// categoryid has FK relationships to several relations (categories, plus a
// couple of reporting views) -- naming "categories"/"accounts" explicitly
// picks the base-table relationship, not the views.
const TRANSACTION_SELECT =
  "*, category:categories(category_name, color), account:accounts(account_name)";

type RawTransactionRow = TransactionRow & {
  category: { category_name: string; color: string | null } | null;
  account: { account_name: string } | null;
};

function flatten(row: RawTransactionRow): TransactionWithRelations {
  const { category, account, ...rest } = row;
  return {
    ...rest,
    category_name: category?.category_name ?? null,
    category_color: category?.color ?? null,
    account_name: account?.account_name ?? null,
  };
}

type UnitKeyRow = {
  id: string;
  transaction_date: string;
  created_at: string;
  transfer_group_id: string | null;
};

// A transfer is two rows sharing transfer_group_id, but must count and page
// as one unit -- otherwise totalCount double-counts every transfer, and
// row-based range() pagination can split a transfer's two legs across a
// page boundary. This groups by coalesce(transfer_group_id, id), in the
// same order the page renders, and returns each unit's row ids.
function groupIntoUnits(rows: UnitKeyRow[]): { unitKeys: string[]; idsByUnit: Map<string, string[]> } {
  const unitKeys: string[] = [];
  const idsByUnit = new Map<string, string[]>();
  for (const row of rows) {
    const unitKey = row.transfer_group_id ?? row.id;
    let ids = idsByUnit.get(unitKey);
    if (!ids) {
      ids = [];
      idsByUnit.set(unitKey, ids);
      unitKeys.push(unitKey);
    }
    ids.push(row.id);
  }
  return { unitKeys, idsByUnit };
}

// Filters live in the caller's URL search params (see the transactions
// page), not component state -- this stays a plain data-layer read with no
// notion of "current" filters, so every filtered view is a linkable,
// server-rendered URL.
export async function listTransactions(
  opts: ListTransactionsOptions = {},
): Promise<DbResult<TransactionsPage>> {
  const supabase = await createClient();

  const page = opts.page && opts.page > 0 ? opts.page : 1;

  // Pass 1: just enough columns to determine unit order and grouping for
  // every row matching the filters -- not the full page's worth of data,
  // since a transfer's pair might sit outside whatever raw range() would've
  // covered. PostgREST's own count is a raw-row count, so it can't answer
  // "how many units" either; counting is done in JS below instead.
  let keyQuery = supabase
    .from("transactions")
    .select("id, transaction_date, created_at, transfer_group_id")
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (opts.dateFrom) {
    keyQuery = keyQuery.gte("transaction_date", opts.dateFrom);
  }
  if (opts.dateTo) {
    keyQuery = keyQuery.lte("transaction_date", opts.dateTo);
  }
  if (opts.categoryid) {
    keyQuery = keyQuery.eq("categoryid", opts.categoryid);
  }
  if (opts.accountid) {
    keyQuery = keyQuery.eq("accountid", opts.accountid);
  }
  if (opts.transaction_type) {
    keyQuery = keyQuery.eq("transaction_type", opts.transaction_type);
  }
  if (opts.transfersOnly) {
    keyQuery = keyQuery.not("transfer_group_id", "is", null);
  }
  if (opts.excludeTransfers) {
    keyQuery = keyQuery.is("transfer_group_id", null);
  }

  const { data: keyRows, error: keyError } = await keyQuery.returns<UnitKeyRow[]>();
  if (keyError) {
    return { data: null, error: keyError.message };
  }

  const { unitKeys, idsByUnit } = groupIntoUnits(keyRows);
  const totalCount = unitKeys.length;

  const from = (page - 1) * TRANSACTIONS_PAGE_SIZE;
  const pageIds = unitKeys.slice(from, from + TRANSACTIONS_PAGE_SIZE).flatMap((key) => idsByUnit.get(key)!);

  // Past the last page (a stale bookmark, or rows deleted since) -- nothing
  // to fetch, but still a real totalCount rather than a DB error.
  if (pageIds.length === 0) {
    return { data: { transactions: [], totalCount }, error: null };
  }

  // Pass 2: full data for exactly the rows this page needs -- both legs of
  // every transfer unit on it, one row for everything else.
  const { data, error } = await supabase
    .from("transactions")
    .select(TRANSACTION_SELECT)
    .in("id", pageIds)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .returns<RawTransactionRow[]>();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: { transactions: data.map(flatten), totalCount }, error: null };
}

// head:true means no rows come back over the wire -- just the count, cheap
// enough to call after every create to check for the first-transaction
// milestone.
export async function getTransactionCount(): Promise<DbResult<number>> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true });

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: count ?? 0, error: null };
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

export type MerchantCategorySuggestion = {
  categoryid: string;
  category_name: string;
  color: string | null;
};

type MerchantMatchRow = {
  categoryid: string;
  category: { category_name: string; color: string | null } | null;
};

// Postgres's default LIKE/ILIKE escape character is backslash -- without
// escaping, a merchant string containing literal "%" or "_" would corrupt
// the wildcard pattern instead of matching those characters literally.
function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}

// Looks at this user's own past transactions only -- RLS scopes both
// queries, no manual userid filter needed. Searches merchant and
// description separately (merchant is optional on the full form, so older
// rows may only carry the text in description) and picks whichever
// category shows up most often across the two, most recent history first.
export async function suggestCategoryForMerchant(
  merchant: string,
  transactionType: TransactionType,
): Promise<DbResult<MerchantCategorySuggestion | null>> {
  const supabase = await createClient();

  const trimmed = merchant.trim();
  if (!trimmed) {
    return { data: null, error: null };
  }

  const pattern = `%${escapeLikePattern(trimmed)}%`;
  const select = "categoryid, category:categories(category_name, color)";

  const [byMerchant, byDescription] = await Promise.all([
    supabase
      .from("transactions")
      .select(select)
      .eq("transaction_type", transactionType)
      .ilike("merchant", pattern)
      .order("transaction_date", { ascending: false })
      .limit(50)
      .returns<MerchantMatchRow[]>(),
    supabase
      .from("transactions")
      .select(select)
      .eq("transaction_type", transactionType)
      .ilike("description", pattern)
      .order("transaction_date", { ascending: false })
      .limit(50)
      .returns<MerchantMatchRow[]>(),
  ]);

  if (byMerchant.error) {
    return { data: null, error: byMerchant.error.message };
  }
  if (byDescription.error) {
    return { data: null, error: byDescription.error.message };
  }

  const counts = new Map<string, { count: number; category_name: string; color: string | null }>();
  for (const row of [...byMerchant.data, ...byDescription.data]) {
    if (!row.category) continue;
    const existing = counts.get(row.categoryid);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(row.categoryid, {
        count: 1,
        category_name: row.category.category_name,
        color: row.category.color,
      });
    }
  }

  let best: (MerchantCategorySuggestion & { count: number }) | null = null;
  for (const [categoryid, entry] of counts) {
    if (!best || entry.count > best.count) {
      best = { categoryid, count: entry.count, category_name: entry.category_name, color: entry.color };
    }
  }

  return {
    data: best ? { categoryid: best.categoryid, category_name: best.category_name, color: best.color } : null,
    error: null,
  };
}

export type CreateTransferInput = {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: string;
  description: string;
  notes?: string | null;
};

// A transfer is two legs sharing a transfer_group_id: an Expense on the
// source account, an Income on the destination, no category on either.
// Inserted together in a single call so a failure can't leave a half-transfer
// -- two separate inserts would risk exactly that.
export async function createTransfer(
  input: CreateTransferInput,
): Promise<DbResult<TransactionRow[]>> {
  if (input.fromAccountId === input.toAccountId) {
    return { data: null, error: "Transfer source and destination accounts must differ." };
  }

  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userid = claimsData?.claims?.sub;

  if (claimsError || !userid) {
    return { data: null, error: "No authenticated user session." };
  }

  const transfer_group_id = crypto.randomUUID();

  const legOut: TransactionInsert = {
    userid,
    accountid: input.fromAccountId,
    categoryid: null,
    amount: input.amount,
    transaction_type: "Expense",
    transaction_date: input.date,
    description: input.description,
    notes: input.notes ?? null,
    transfer_group_id,
  };

  const legIn: TransactionInsert = {
    userid,
    accountid: input.toAccountId,
    categoryid: null,
    amount: input.amount,
    transaction_type: "Income",
    transaction_date: input.date,
    description: input.description,
    notes: input.notes ?? null,
    transfer_group_id,
  };

  const { data, error } = await supabase
    .from("transactions")
    .insert([legOut, legIn])
    .select();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export type UpdateTransferPatch = Pick<
  TransactionUpdate,
  "amount" | "transaction_date" | "description" | "notes"
>;

// Both legs share everything but accountid/transaction_type, so the patch
// applies identically to both -- never target a single leg.
export async function updateTransfer(
  groupId: string,
  patch: UpdateTransferPatch,
): Promise<DbResult<TransactionRow[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("transactions")
    .update(patch)
    .eq("transfer_group_id", groupId)
    .select();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

// One statement targeting the whole group -- never delete a single leg.
export async function deleteTransfer(groupId: string): Promise<DbResult<{ id: string }[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("transactions")
    .delete()
    .eq("transfer_group_id", groupId)
    .select("id");

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

// Quick-add's account prefill -- the account behind whichever transaction
// was logged most recently, not necessarily most recently created.
export async function getMostRecentTransactionAccountId(): Promise<DbResult<string | null>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("transactions")
    .select("accountid")
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data?.accountid ?? null, error: null };
}
