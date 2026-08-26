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

// Filters live in the caller's URL search params (see the transactions
// page), not component state -- this stays a plain data-layer read with no
// notion of "current" filters, so every filtered view is a linkable,
// server-rendered URL.
export async function listTransactions(
  opts: ListTransactionsOptions = {},
): Promise<DbResult<TransactionsPage>> {
  const supabase = await createClient();

  const page = opts.page && opts.page > 0 ? opts.page : 1;
  const from = (page - 1) * TRANSACTIONS_PAGE_SIZE;
  const to = from + TRANSACTIONS_PAGE_SIZE - 1;

  let query = supabase
    .from("transactions")
    .select(TRANSACTION_SELECT, { count: "exact" })
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
  if (opts.transfersOnly) {
    query = query.not("transfer_group_id", "is", null);
  }
  if (opts.excludeTransfers) {
    query = query.is("transfer_group_id", null);
  }

  const { data, error, count } = await query.range(from, to).returns<RawTransactionRow[]>();

  if (error) {
    // A page past the last one isn't a real error -- PostgREST answers a
    // range starting beyond the row count with 416 Range Not Satisfiable.
    // Reachable just by editing ?page= or a stale bookmark after rows are
    // deleted, so fall back to a fresh, identically-filtered count-only
    // query (a Postgrest builder mutates itself as it's chained, so the
    // already-executed `query` above can't be reused for a second request)
    // and report zero rows instead of surfacing a raw DB error.
    if (/range not satisfiable/i.test(error.message)) {
      let countQuery = supabase
        .from("transactions")
        .select("id", { count: "exact", head: true });

      if (opts.dateFrom) {
        countQuery = countQuery.gte("transaction_date", opts.dateFrom);
      }
      if (opts.dateTo) {
        countQuery = countQuery.lte("transaction_date", opts.dateTo);
      }
      if (opts.categoryid) {
        countQuery = countQuery.eq("categoryid", opts.categoryid);
      }
      if (opts.accountid) {
        countQuery = countQuery.eq("accountid", opts.accountid);
      }
      if (opts.transaction_type) {
        countQuery = countQuery.eq("transaction_type", opts.transaction_type);
      }
      if (opts.transfersOnly) {
        countQuery = countQuery.not("transfer_group_id", "is", null);
      }
      if (opts.excludeTransfers) {
        countQuery = countQuery.is("transfer_group_id", null);
      }

      const { count: totalCount, error: countError } = await countQuery;
      if (countError) {
        return { data: null, error: countError.message };
      }
      return { data: { transactions: [], totalCount: totalCount ?? 0 }, error: null };
    }
    return { data: null, error: error.message };
  }

  return { data: { transactions: data.map(flatten), totalCount: count ?? 0 }, error: null };
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
