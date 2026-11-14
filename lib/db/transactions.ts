import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { describeReadError, describeWriteError, sessionUserId } from "@/lib/db/errors";
import { buildSearchOr, escapeLike, MAX_SEARCH_LENGTH } from "@/lib/transactionFilters";
import { NO_ANCHOR_ANSWER, type AnchorAnswerColumns, type AnchorPreview } from "@/lib/anchorAnswer";

type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"];
type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type TransactionUpdate = Database["public"]["Tables"]["transactions"]["Update"];

export type TransactionType = "Income" | "Expense";

export type TransactionWithRelations = TransactionRow & {
  category_name: string | null;
  category_color: string | null;
  account_name: string | null;
};

// The edit page's read: the row plus whether it counts toward its
// account's balance, answered in SQL (counts_toward_balance, migration 48).
export type TransactionForEdit = TransactionWithRelations & {
  counts_toward_balance: boolean | null;
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
  /**
   * Free-text search: description, notes, category name, account name, or an
   * exact amount. Composes with every other filter. Server-side.
   */
  q?: string;
  /** 1-indexed. Defaults to 1. */
  page?: number;
};

export type TransactionsPage = {
  transactions: TransactionWithRelations[];
  totalCount: number;
  /**
   * Set when PostgREST's `max-rows` ceiling truncated the read: the list can
   * only reach the most recent `transactionsShown` of `transactionsTotal`
   * rows, and the older ones aren't available here. null in the normal case,
   * where the whole matching history came back.
   */
  truncation: { transactionsShown: number; transactionsTotal: number } | null;
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
  // count:"exact" is a raw-row count (a transfer is two rows). Compared
  // against keyRows.length -- also raw rows -- it's how truncation is
  // detected below, with no magic threshold: whatever the project's
  // max-rows ceiling is, keyRows.length lands exactly on it and count runs
  // past it.
  let keyQuery = supabase
    .from("transactions")
    .select("id, transaction_date, created_at, transfer_group_id", { count: "exact" })
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
  const q = opts.q?.trim().slice(0, MAX_SEARCH_LENGTH);
  if (q) {
    // Category and account names live in other tables: find which ones
    // matched, then filter this table by their ids alongside its own
    // columns. Both lookups are RLS-scoped to the person's own rows.
    const pattern = `%${escapeLike(q)}%`;
    const [categoriesRes, accountsRes] = await Promise.all([
      supabase.from("categories").select("id").ilike("category_name", pattern),
      supabase.from("accounts").select("id").ilike("account_name", pattern),
    ]);
    if (categoriesRes.error) {
      return { data: null, error: describeReadError(categoriesRes.error, "transactions") };
    }
    if (accountsRes.error) {
      return { data: null, error: describeReadError(accountsRes.error, "transactions") };
    }
    keyQuery = keyQuery.or(
      buildSearchOr(
        q,
        categoriesRes.data.map((c) => c.id),
        accountsRes.data.map((a) => a.id),
      ),
    );
  }
  if (opts.transfersOnly) {
    keyQuery = keyQuery.not("transfer_group_id", "is", null);
  }
  if (opts.excludeTransfers) {
    keyQuery = keyQuery.is("transfer_group_id", null);
  }

  const {
    data: keyRows,
    error: keyError,
    count: rawRowCount,
  } = await keyQuery.returns<UnitKeyRow[]>();
  if (keyError) {
    return { data: null, error: describeReadError(keyError, "transactions") };
  }

  // PostgREST caps a range-less result at the project's max-rows setting and
  // returns 206, not an error -- so without this check a heavy user would
  // page through a partial history behind a confidently wrong total, with
  // nothing saying rows were missing. keyRows is newest-first, so what's
  // dropped is the oldest. Hand the caller the numbers for an honest banner
  // rather than blanking the page or lying in the footer.
  const truncation =
    rawRowCount !== null && keyRows.length < rawRowCount
      ? { transactionsShown: keyRows.length, transactionsTotal: rawRowCount }
      : null;

  const { unitKeys, idsByUnit } = groupIntoUnits(keyRows);
  // Exact when the whole history came back; when truncated, the count of
  // units actually reachable through pagination (every one still resolves).
  const totalCount = unitKeys.length;

  const from = (page - 1) * TRANSACTIONS_PAGE_SIZE;
  const pageUnitKeys = unitKeys.slice(from, from + TRANSACTIONS_PAGE_SIZE);
  const pageIds = pageUnitKeys.flatMap((key) => idsByUnit.get(key)!);

  // A filter on account, category or text can match only ONE leg of a
  // transfer (the Expense leg sits on the source account, the Income leg on
  // the destination). A transfer is one thing with two legs, so a unit on
  // this page brings both -- the list shows "Checking -> Visa", never half.
  const transferGroupIds = new Set(
    keyRows.flatMap((r) => (r.transfer_group_id ? [r.transfer_group_id] : [])),
  );
  const pageGroupIds = pageUnitKeys.filter((key) => transferGroupIds.has(key));
  if (pageGroupIds.length > 0) {
    const { data: legRows, error: legError } = await supabase
      .from("transactions")
      .select("id")
      .in("transfer_group_id", pageGroupIds);
    if (legError) {
      return { data: null, error: describeReadError(legError, "transactions") };
    }
    const have = new Set(pageIds);
    for (const leg of legRows) if (!have.has(leg.id)) pageIds.push(leg.id);
  }

  // Past the last page (a stale bookmark, or rows deleted since) -- nothing
  // to fetch, but still a real totalCount rather than a DB error.
  if (pageIds.length === 0) {
    return { data: { transactions: [], totalCount, truncation }, error: null };
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
    return { data: null, error: describeReadError(error, "transactions") };
  }

  return { data: { transactions: data.map(flatten), totalCount, truncation }, error: null };
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
    return { data: null, error: describeReadError(error, "transactions") };
  }

  return { data: count ?? 0, error: null };
}

// null means there's no such transaction for this user: a bad id, a row
// deleted in another tab, or another user's row (RLS hides it). Absence is
// legitimate here, so .maybeSingle() -- an error is a real load failure.
export async function getTransaction(
  id: string,
): Promise<DbResult<TransactionForEdit | null>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("transactions")
    .select(`${TRANSACTION_SELECT}, counts_toward_balance`)
    .eq("id", id)
    .maybeSingle()
    .returns<(RawTransactionRow & { counts_toward_balance: boolean | null }) | null>();

  if (error) {
    return { data: null, error: describeReadError(error, "transaction") };
  }

  return {
    data: data ? { ...flatten(data), counts_toward_balance: data.counts_toward_balance } : null,
    error: null,
  };
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

  const session = sessionUserId(await supabase.auth.getClaims(), "transaction");
  if (session.userid === null) {
    return { data: null, error: session.error };
  }
  const { userid } = session;

  // Pre-check so a mismatched category/type pair gets a readable error
  // instead of the DB trigger's raw errcode 23514 exception. The trigger
  // (enforce_category_type) still enforces this at the DB layer regardless.
  const { data: category, error: categoryError } = await supabase
    .from("categories")
    .select("category_type")
    .eq("id", input.categoryid)
    .single();

  if (categoryError) {
    return { data: null, error: describeWriteError(categoryError, "transaction") };
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
    // 23505 on transactions_userid_idempotency_key_key means this exact
    // idempotency_key was already inserted -- a retry of a request that
    // already succeeded, not a new transaction. Return the original row
    // instead of surfacing a "duplicate" error the user didn't cause.
    if (error.code === "23505" && input.idempotency_key) {
      const { data: existing, error: existingError } = await supabase
        .from("transactions")
        .select()
        .eq("userid", userid)
        .eq("idempotency_key", input.idempotency_key)
        .single();

      if (existingError) {
        return { data: null, error: describeWriteError(existingError, "transaction") };
      }
      return { data: existing, error: null };
    }

    return { data: null, error: describeWriteError(error, "transaction") };
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
    return { data: null, error: describeWriteError(error, "transaction") };
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
    return { data: null, error: describeWriteError(error, "transaction") };
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
    return { data: null, error: describeReadError(byMerchant.error, "transactions") };
  }
  if (byDescription.error) {
    return { data: null, error: describeReadError(byDescription.error, "transactions") };
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
  /** Each leg's pre-anchor answer (migration 62) -- two accounts, two anchors. */
  fromAnchorAnswer?: AnchorAnswerColumns;
  toAnchorAnswer?: AnchorAnswerColumns;
  // Rides on the outgoing leg only: the unique index is (userid,
  // idempotency_key), so both legs can't carry it. One leg is enough -- the
  // two are inserted in one statement, so if that leg exists, so does the
  // transfer.
  idempotency_key?: string | null;
};

// A transfer is two legs sharing a transfer_group_id: an Expense on the
// source account, an Income on the destination, no category on either.
// Inserted together in a single call so a failure can't leave a half-transfer
// -- two separate inserts would risk exactly that.
export async function createTransfer(
  input: CreateTransferInput,
): Promise<DbResult<TransactionRow[]>> {
  if (input.fromAccountId === input.toAccountId) {
    return { data: null, error: "Choose two different accounts for a transfer." };
  }

  const supabase = await createClient();

  const session = sessionUserId(await supabase.auth.getClaims(), "transaction");
  if (session.userid === null) {
    return { data: null, error: session.error };
  }
  const { userid } = session;

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
    idempotency_key: input.idempotency_key ?? null,
    ...(input.fromAnchorAnswer ?? NO_ANCHOR_ANSWER),
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
    ...(input.toAnchorAnswer ?? NO_ANCHOR_ANSWER),
  };

  const { data, error } = await supabase
    .from("transactions")
    .insert([legOut, legIn])
    .select();

  if (error) {
    // Same as createTransaction: a retry of a transfer that already landed.
    // Return its two legs rather than a duplicate error.
    if (error.code === "23505" && input.idempotency_key) {
      const { data: existingOut, error: outError } = await supabase
        .from("transactions")
        .select("transfer_group_id")
        .eq("userid", userid)
        .eq("idempotency_key", input.idempotency_key)
        .single();

      if (outError) {
        return { data: null, error: describeWriteError(outError, "transfer") };
      }
      if (existingOut.transfer_group_id === null) {
        // The key belongs to a plain transaction. Keys are minted per
        // submission, so this is a client bug, not a user's retry.
        return {
          data: null,
          error: describeWriteError(
            { message: "idempotency key matched a non-transfer row" },
            "transfer",
          ),
        };
      }

      const { data: legs, error: legsError } = await supabase
        .from("transactions")
        .select()
        .eq("transfer_group_id", existingOut.transfer_group_id);

      if (legsError) {
        return { data: null, error: describeWriteError(legsError, "transfer") };
      }
      return { data: legs, error: null };
    }

    return { data: null, error: describeWriteError(error, "transfer") };
  }

  return { data, error: null };
}

export type UpdateTransferInput = {
  transferGroupId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: string;
  description: string;
  notes: string | null;
  /** "This and future occurrences": also set the schedule's amount. */
  updateSchedule: boolean;
  /** Each leg's pre-anchor answer (migration 62), following its account. */
  fromAnchorAnswer: AnchorAnswerColumns;
  toAnchorAnswer: AnchorAnswerColumns;
};

// The ONLY write path for an existing transfer: update_transfer()
// (migration 59) writes both legs in one call, so they can't disagree --
// two client updates could leave legs that don't net to zero. Any other
// update of a leg is refused by trg_transactions_transfer_pair. Swapping
// from and to swaps the direction.
export async function updateTransfer(input: UpdateTransferInput): Promise<DbResult<null>> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("update_transfer", {
    p_transfer_group_id: input.transferGroupId,
    p_from_accountid: input.fromAccountId,
    p_to_accountid: input.toAccountId,
    p_amount: input.amount,
    p_transaction_date: input.date,
    p_description: input.description,
    p_notes: input.notes ?? undefined,
    p_update_schedule: input.updateSchedule,
    p_from_counts_despite_anchor: input.fromAnchorAnswer.counts_despite_anchor ?? undefined,
    p_from_anchor_answer_set_at: input.fromAnchorAnswer.anchor_answer_set_at ?? undefined,
    p_to_counts_despite_anchor: input.toAnchorAnswer.counts_despite_anchor ?? undefined,
    p_to_anchor_answer_set_at: input.toAnchorAnswer.anchor_answer_set_at ?? undefined,
  });

  if (error) {
    if (error.code === "P0002") {
      return { data: null, error: "That transfer or one of its accounts isn't there anymore." };
    }
    return { data: null, error: describeWriteError(error, "transfer") };
  }
  return { data: null, error: null };
}

export type ScheduleSummary = { id: string; description: string; amountIsVariable: boolean };

// The schedule a confirmed transaction came from, for the edit-scope
// question (lib/recurringEditScope.ts). null when there's no recurringid or
// the schedule has since been deleted (recurringid is ON DELETE SET NULL,
// so normally the former).
export async function getScheduleSummary(recurringid: string | null): Promise<DbResult<ScheduleSummary | null>> {
  if (recurringid === null) return { data: null, error: null };
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("recurring_transactions")
    .select("id, description, amount_is_variable")
    .eq("id", recurringid)
    .maybeSingle();

  if (error) {
    return { data: null, error: describeReadError(error, "transaction") };
  }
  return {
    data: data ? { id: data.id, description: data.description, amountIsVariable: data.amount_is_variable } : null,
    error: null,
  };
}

export type TransferForEdit = {
  transferGroupId: string;
  /** The Expense leg -- money leaves this account. */
  fromLeg: { id: string; accountId: string; anchorAnswer: AnchorAnswerColumns };
  /** The Income leg -- money lands here. */
  toLeg: { id: string; accountId: string; anchorAnswer: AnchorAnswerColumns };
  amount: number;
  date: string;
  description: string;
  notes: string | null;
  /** The schedule both legs were confirmed from, when it still exists. */
  schedule: ScheduleSummary | null;
};

// Both legs as one transfer, for the transfer editor. null when the group
// isn't the caller's or isn't a whole pair -- nothing to edit.
export async function getTransferForEdit(groupId: string): Promise<DbResult<TransferForEdit | null>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("transactions")
    .select(
      "id, accountid, transaction_type, amount, transaction_date, description, notes, recurringid, counts_despite_anchor, anchor_answer_set_at",
    )
    .eq("transfer_group_id", groupId);

  if (error) {
    return { data: null, error: describeReadError(error, "transfer") };
  }

  const fromLeg = data.find((l) => l.transaction_type === "Expense");
  const toLeg = data.find((l) => l.transaction_type === "Income");
  if (data.length !== 2 || !fromLeg || !toLeg) {
    return { data: null, error: null };
  }

  const scheduleResult = await getScheduleSummary(fromLeg.recurringid);
  if (scheduleResult.error !== null) {
    return { data: null, error: scheduleResult.error };
  }
  const schedule = scheduleResult.data;

  return {
    data: {
      transferGroupId: groupId,
      fromLeg: { id: fromLeg.id, accountId: fromLeg.accountid, anchorAnswer: legAnswer(fromLeg) },
      toLeg: { id: toLeg.id, accountId: toLeg.accountid, anchorAnswer: legAnswer(toLeg) },
      amount: Number(fromLeg.amount),
      date: fromLeg.transaction_date,
      description: fromLeg.description,
      notes: fromLeg.notes,
      schedule,
    },
    error: null,
  };
}

// Bulk delete for the list's selection bar -- one statement covering plain
// transaction ids and whole transfer groups together (never a loop of
// individual deletes). transferGroupIds expands to both legs automatically,
// same as deleteTransfer. RLS still scopes every row to auth.uid() regardless
// of this filter, so a malformed id can only ever fail to match, never widen
// the delete beyond the caller's own rows.
export async function bulkDeleteTransactions(
  transactionIds: string[],
  transferGroupIds: string[],
): Promise<DbResult<{ id: string }[]>> {
  if (transactionIds.length === 0 && transferGroupIds.length === 0) {
    return { data: [], error: null };
  }

  const supabase = await createClient();

  const filters: string[] = [];
  if (transactionIds.length > 0) {
    filters.push(`id.in.(${transactionIds.join(",")})`);
  }
  if (transferGroupIds.length > 0) {
    filters.push(`transfer_group_id.in.(${transferGroupIds.join(",")})`);
  }

  const { data, error } = await supabase
    .from("transactions")
    .delete()
    .or(filters.join(","))
    .select("id");

  if (error) {
    return { data: null, error: describeWriteError(error, "transaction") };
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
    return { data: null, error: describeWriteError(error, "transfer") };
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
    return { data: null, error: describeReadError(error, "transactions") };
  }

  return { data: data?.accountid ?? null, error: null };
}

// The pre-anchor question's facts for an account and a date the person is
// still choosing (balance_anchor_preview, migration 62): whether the date
// rule alone counts it -- false means ask -- and the anchor it would be
// asked about. transactionId names the transaction being edited (its own
// recorded time decides); null means a new one, recorded now. data is
// null when the account isn't visible.
export async function balanceAnchorPreview(
  accountId: string,
  transactionDate: string,
  transactionId: string | null,
): Promise<DbResult<AnchorPreview | null>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("balance_anchor_preview", {
      p_accountid: accountId,
      p_transaction_date: transactionDate,
      p_transaction_id: transactionId ?? undefined,
    })
    .maybeSingle();

  if (error) {
    return { data: null, error: describeReadError(error, "transaction") };
  }
  if (!data) {
    return { data: null, error: null };
  }

  return {
    data: {
      countsByDate: data.counts_by_date,
      anchorBalance: Number(data.anchor_balance),
      anchorDate: data.anchor_date,
      anchorSetAt: data.anchor_set_at,
      accountType: data.account_type,
    },
    error: null,
  };
}

function legAnswer(leg: { counts_despite_anchor: boolean | null; anchor_answer_set_at: string | null }): AnchorAnswerColumns {
  return { counts_despite_anchor: leg.counts_despite_anchor, anchor_answer_set_at: leg.anchor_answer_set_at };
}
