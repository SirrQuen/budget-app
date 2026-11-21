import "server-only";
import { createClient } from "@/lib/supabase/server";
import { classifyDbError, describeReadError, UNREACHABLE, type DbError } from "@/lib/db/errors";
import { getToday } from "@/lib/db/settings";
import { getAccount, getAccountBalance } from "@/lib/db/accounts";
import { getConfirmationQueue } from "@/lib/db/dashboard";
import { getSameBillCycle } from "@/lib/db/recurring";
import { getSameBillDeletePreviews } from "@/lib/db/sameBill";
import { addDaysISO } from "@/lib/date";
import { formatDate } from "@/lib/format";
import {
  MAX_DESCRIPTION,
  MAX_IMPORT_ROWS,
  MAX_MERCHANT,
  MAX_NOTES,
  MAX_PAYMENT_METHOD,
  type ImportType,
} from "@/lib/importCsv";
import {
  DUPLICATE_WINDOW_DAYS,
  unincludedDuplicates,
  type CategoryOption,
  type DateTreatment,
  type ExistingTransaction,
} from "@/lib/importReview";
import { findImportSameBill, sameBillDeleteNote, type ImportSameBillItem } from "@/lib/sameBill";
import {
  TRANSFER_MATCH_DAYS,
  buildCategoryHistory,
  sameBillRows,
  type CategoryHistoryEntry,
  type TransferCandidate,
} from "@/lib/importTransfers";

// Import's reads and writes (migrations 68 and 76, docs/Import-CSV.md). The
// file itself never gets here. Before Import, a read takes an account and
// the file's DATES -- no descriptions, no amounts -- and sends back the
// person's own data for the browser to match against. The one write takes
// only the rows a person confirmed in the preview.

export type DbResult<T> = { data: T; error: null } | { data: null; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------
// Errors: the code, and nothing else
//
// An import's errors are logged by SQLSTATE CODE ONLY -- never the
// message, details or hint. Postgres puts the failing row's VALUES in the
// detail of a constraint error ("Failing row contains (...)"), and a bank
// row is a description, an amount and a date: the privacy promise is that
// no row content reaches a log, an error report or analytics, including on
// failure (docs/Import-CSV.md, "Privacy"). The usual describeWriteError()
// logs the whole error, so import doesn't use it.
//
// What a person is TOLD is likewise either a fixed sentence or one of
// migration 68/76's own messages, which name a row number and never its
// content -- and only those, recognised by their exact shape. Anything else
// Postgres said is never shown.
// ---------------------------------------------------------------------
const OWN_MESSAGE = [
  /^Row [0-9A-Za-z#]{1,12} could not be imported: [^"]{1,120}$/,
  /^Row [0-9A-Za-z#]{1,12} could not be matched to its schedule \([a-z_]{1,20}\)\. Nothing was imported\.$/,
  /^There is nothing to import\.$/,
  /^An import can have at most 5,000 transactions\. Split the file and import it in parts\.$/,
  /^This account is archived, so nothing can be imported into it\.$/,
];

const IMPORT_STALE =
  "A bill you matched has changed since you started, so nothing was imported. Go back and review the preview again.";
const IMPORT_PAIR_STALE =
  "An entry you joined to a transfer has changed since you started, so nothing was imported. Go back and review the preview again.";
const IMPORT_DUPLICATES =
  "Some rows look like transactions you already have and weren't ticked to include, so nothing was imported. Go back and review the preview again.";
const IMPORT_GENERIC = "That didn't import, and nothing was saved. It's not something you did. Try again in a moment.";

function describeImportError(error: DbError, what: string): string {
  // The code is the whole log line. See the note above.
  console.warn(`[db:import] ${what} failed, code=${error.code || "none"}`);
  switch (classifyDbError(error)) {
    case "network-unreachable":
      return UNREACHABLE;
    case "auth-expired":
      return "Your session ended, so nothing was imported. Sign in again and start the import over.";
    default:
      break;
  }
  if (error.code === "SIM01") return IMPORT_STALE;
  if (error.code === "SIP01") return IMPORT_PAIR_STALE;
  // undo_import(): a later import joined one of this one's rows (migration 76).
  if (error.code === "SIU01") {
    const day = /\d{4}-\d{2}-\d{2}/.exec(error.message)?.[0];
    return day
      ? `Undo the import from ${formatDate(day)} first. It made one of these transactions part of a transfer.`
      : "Undo the later import first. It made one of these transactions part of a transfer.";
  }
  if (error.code === "SRA01" || error.code === "SRA02") {
    return "A balance date changed while you were importing, so nothing was imported. Start the preview again.";
  }
  if (error.code === "P0002") return "That account isn't available to import into.";
  if (OWN_MESSAGE.some((re) => re.test(error.message))) return error.message;
  return IMPORT_GENERIC;
}

// ---------------------------------------------------------------------
// The preview's context: what the database knows
// ---------------------------------------------------------------------

export type OtherAccount = {
  id: string;
  name: string;
  type: string;
  openingDate: string;
  openingBalance: number;
  balance: number;
  /** import_preview() on THIS account: a transfer's other leg answers to its balance date. */
  treatments: ({ date: string } & DateTreatment)[];
};

export type ImportContext = {
  today: string;
  account: {
    id: string;
    name: string;
    type: string;
    openingDate: string;
    openingBalance: number;
    balance: number;
  };
  /** import_preview(): how counts_in_balance() treats a row on each date. */
  treatments: ({ date: string } & DateTreatment)[];
  /** The account's transactions around the file's dates, for the duplicate flag. */
  existing: ExistingTransaction[];
  /** Active categories -- what a row can be matched to or put in. */
  categories: CategoryOption[];
  /** Occurrences waiting in the confirmation queue on this account (a transfer at either end). */
  queue: ImportSameBillItem[];
  /** The person's other active accounts (migration 76). */
  otherAccounts: OtherAccount[];
  /**
   * Plain entries on those accounts around the file's dates: the other side
   * a transfer row may already have. The browser matches against them.
   */
  transferCandidates: TransferCandidate[];
  /** Each merchant's usual category, from the person's own entries (capped). */
  categoryHistory: CategoryHistoryEntry[];
};

const PAGE = 1000;
const MAX_PAGES = 50;

type Client = Awaited<ReturnType<typeof createClient>>;

/** The account's transactions from `from` to `to`, for the duplicate check -- the preview's and the server's re-run. */
async function readExisting(
  supabase: Client,
  accountId: string,
  from: string,
  to: string,
): Promise<DbResult<ExistingTransaction[]>> {
  const existing: ExistingTransaction[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, transaction_date, amount, description, transaction_type")
      .eq("accountid", accountId)
      .gte("transaction_date", from)
      .lte("transaction_date", to)
      .order("transaction_date")
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return { data: null, error: describeReadError(error, "transactions") };
    for (const t of data) {
      existing.push({
        id: t.id,
        date: t.transaction_date,
        // One conversion of a two-decimal figure, not a sum.
        cents: Math.round(Number(t.amount) * 100),
        description: t.description,
        type: t.transaction_type as ImportType,
      });
    }
    if (data.length < PAGE) break;
  }
  return { data: existing, error: null };
}

export async function getImportContext(
  accountId: string,
  dates: readonly string[],
): Promise<DbResult<ImportContext>> {
  if (!UUID.test(accountId)) return { data: null, error: "Choose an account to import into." };
  if (dates.length === 0 || dates.length > MAX_IMPORT_ROWS || !dates.every((d) => ISO.test(d))) {
    return { data: null, error: "We couldn't read the dates in that file." };
  }
  const distinct = [...new Set(dates)].sort();
  const from = addDaysISO(distinct[0], -DUPLICATE_WINDOW_DAYS);
  const to = addDaysISO(distinct[distinct.length - 1], DUPLICATE_WINDOW_DAYS);

  const supabase = await createClient();
  const [today, accountRes, balanceRes, previewRes, categoriesRes, queueRes] = await Promise.all([
    getToday(),
    getAccount(accountId),
    getAccountBalance(accountId),
    // Dates only: no descriptions, no amounts.
    supabase.rpc("import_preview", { p_accountid: accountId, p_dates: distinct }),
    supabase.from("categories").select("id, category_name, category_type").eq("is_active", true),
    getConfirmationQueue(),
  ]);

  if (accountRes.error !== null) return { data: null, error: accountRes.error };
  if (balanceRes.error !== null) return { data: null, error: balanceRes.error };
  if (balanceRes.data === null) return { data: null, error: "That account isn't available to import into." };
  if (previewRes.error) return { data: null, error: describeReadError(previewRes.error, "import preview") };
  if (categoriesRes.error) return { data: null, error: describeReadError(categoriesRes.error, "categories") };
  if (queueRes.error !== null) return { data: null, error: queueRes.error };

  const account = accountRes.data;
  if (!account.is_active) return { data: null, error: "This account is archived, so nothing can be imported into it." };

  const activeCategoryIds = new Set(categoriesRes.data.map((c) => c.id));
  const [existingRes, othersRes, historyRes] = await Promise.all([
    readExisting(supabase, accountId, from, to),
    readOtherAccounts(supabase, accountId, distinct),
    readCategoryHistory(supabase, addDaysISO(today, -365), activeCategoryIds),
  ]);
  if (existingRes.error !== null) return { data: null, error: existingRes.error };
  if (othersRes.error !== null) return { data: null, error: othersRes.error };
  if (historyRes.error !== null) return { data: null, error: historyRes.error };

  const candidatesRes = await readTransferCandidates(
    supabase,
    othersRes.data.map((a) => a.id),
    addDaysISO(distinct[0], -TRANSFER_MATCH_DAYS),
    addDaysISO(distinct[distinct.length - 1], TRANSFER_MATCH_DAYS),
  );
  if (candidatesRes.error !== null) return { data: null, error: candidatesRes.error };

  return {
    data: {
      today,
      account: {
        id: account.id,
        name: account.account_name,
        type: account.account_type,
        openingDate: account.opening_date,
        openingBalance: Number(account.opening_balance),
        balance: Number(balanceRes.data.balance ?? 0),
      },
      treatments: previewRes.data.map((t) => ({
        date: t.transaction_date,
        treatment: t.treatment as DateTreatment["treatment"],
        countsIfIncluded: t.counts_if_included,
        countsIfAdded: t.counts_if_added,
      })),
      existing: existingRes.data,
      categories: categoriesRes.data.map((c) => ({
        id: c.id,
        name: c.category_name,
        type: c.category_type as ImportType,
      })),
      queue: importQueueItems(queueRes.data, accountId),
      otherAccounts: othersRes.data,
      transferCandidates: candidatesRes.data,
      categoryHistory: historyRes.data,
    },
    error: null,
  };
}

/** Every other active account, its balance, and how each of the file's dates sits against ITS balance date. */
async function readOtherAccounts(supabase: Client, accountId: string, dates: string[]): Promise<DbResult<OtherAccount[]>> {
  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("id, account_name, account_type, opening_date, opening_balance")
    .eq("is_active", true)
    .neq("id", accountId)
    .order("account_name");
  if (error) return { data: null, error: describeReadError(error, "accounts") };
  if (accounts.length === 0) return { data: [], error: null };

  const ids = accounts.map((a) => a.id);
  const [balancesRes, ...previews] = await Promise.all([
    supabase.from("v_account_balances").select("account_id, balance").in("account_id", ids),
    // Dates only, as for the import's own account: no descriptions, no amounts.
    ...ids.map((id) => supabase.rpc("import_preview", { p_accountid: id, p_dates: dates })),
  ]);
  if (balancesRes.error) return { data: null, error: describeReadError(balancesRes.error, "accounts") };
  const balance = new Map(balancesRes.data.map((b) => [b.account_id, Number(b.balance ?? 0)]));
  const out: OtherAccount[] = [];
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    const p = previews[i];
    if (p.error) return { data: null, error: describeReadError(p.error, "import preview") };
    out.push({
      id: a.id,
      name: a.account_name,
      type: a.account_type,
      openingDate: a.opening_date,
      openingBalance: Number(a.opening_balance),
      balance: balance.get(a.id) ?? 0,
      treatments: p.data.map((t) => ({
        date: t.transaction_date,
        treatment: t.treatment as DateTreatment["treatment"],
        countsIfIncluded: t.counts_if_included,
        countsIfAdded: t.counts_if_added,
      })),
    });
  }
  return { data: out, error: null };
}

/**
 * Plain entries (not a transfer leg) on the other accounts between `from`
 * and `to` -- what a transfer row's other side may already be. Read by
 * (accountid, transaction_date): idx_tx_account_date covers it. Whether
 * each can be JOINED is migration 76's rule, said here so the preview asks
 * only what the server will accept; the server checks it again.
 */
async function readTransferCandidates(
  supabase: Client,
  accountIds: string[],
  from: string,
  to: string,
): Promise<DbResult<TransferCandidate[]>> {
  if (accountIds.length === 0) return { data: [], error: null };
  const rows: TransferCandidate[] = [];
  const flags: { recurringid: string | null; goalid: string | null }[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, accountid, transaction_date, amount, description, transaction_type, recurringid, goalid")
      .in("accountid", accountIds)
      .is("transfer_group_id", null)
      .gte("transaction_date", from)
      .lte("transaction_date", to)
      .order("transaction_date")
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return { data: null, error: describeReadError(error, "transactions") };
    for (const t of data) {
      rows.push({
        id: t.id,
        accountId: t.accountid,
        date: t.transaction_date,
        cents: Math.round(Number(t.amount) * 100),
        type: t.transaction_type as ImportType,
        description: t.description,
        pairable: false,
      });
      flags.push({ recurringid: t.recurringid, goalid: t.goalid });
    }
    if (data.length < PAGE) break;
  }
  // A row with a same-bill answer of either kind isn't joinable.
  const answered = new Set<string>();
  for (let i = 0; i < rows.length; i += 200) {
    const ids = rows.slice(i, i + 200).map((r) => r.id);
    const { data, error } = await supabase.from("same_bill_answers").select("transactionid").in("transactionid", ids);
    if (error) return { data: null, error: describeReadError(error, "same-bill answers") };
    for (const a of data) answered.add(a.transactionid);
  }
  rows.forEach((r, i) => {
    r.pairable = flags[i].recurringid === null && !answered.has(r.id) && !(r.type === "Income" && flags[i].goalid !== null);
  });
  return { data: rows, error: null };
}

const HISTORY_PAGES = 20;

/** The person's own categorised entries since `since`, newest first, as a capped merchant -> category map. */
async function readCategoryHistory(
  supabase: Client,
  since: string,
  activeCategoryIds: ReadonlySet<string>,
): Promise<DbResult<CategoryHistoryEntry[]>> {
  const rows: { description: string; categoryId: string; type: ImportType }[] = [];
  for (let page = 0; page < HISTORY_PAGES; page++) {
    const { data, error } = await supabase
      .from("transactions")
      .select("description, categoryid, transaction_type")
      .is("transfer_group_id", null)
      .not("categoryid", "is", null)
      .gte("transaction_date", since)
      .order("transaction_date", { ascending: false })
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return { data: null, error: describeReadError(error, "transactions") };
    for (const t of data) {
      if (t.categoryid) rows.push({ description: t.description, categoryId: t.categoryid, type: t.transaction_type as ImportType });
    }
    if (data.length < PAGE) break;
  }
  return { data: buildCategoryHistory(rows, activeCategoryIds), error: null };
}

/**
 * The queue items an imported row can be the same bill as: "to confirm",
 * not already recorded, on this account -- a transfer schedule at either
 * end (migration 76; findImportSameBill matches both ends).
 */
function importQueueItems(
  queue: Awaited<ReturnType<typeof getConfirmationQueue>> extends { data: infer D } ? NonNullable<D> : never,
  accountId: string,
): ImportSameBillItem[] {
  return queue
    .filter(
      (i) =>
        i.state === "to-confirm" &&
        (i.accountId === accountId || i.toAccountId === accountId) &&
        i.alreadyRecorded === null,
    )
    .map((i) => ({
      recurringId: i.recurringId,
      name: i.name,
      kind: i.kind,
      accountId: i.accountId,
      toAccountId: i.toAccountId,
      amount: i.amount,
      dueDate: i.dueDate,
      dateToleranceDays: i.dateToleranceDays,
    }));
}

// ---------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------

export type ImportRowInput = {
  /** The file's row number -- only for an error message. */
  row: number;
  date: string;
  cents: number;
  type: ImportType;
  description: string;
  notes: string | null;
  merchant: string | null;
  paymentMethod: string | null;
  /** Required on every row but a transfer, which has none. */
  categoryId: string | null;
  /**
   * A transfer between the import's account and another (migration 76).
   * `type` says which way. pairWith: an existing entry on the other account
   * to make the other leg, else both legs are created. countsDespiteAnchor:
   * the OTHER account's pre-anchor answer for a created leg.
   */
  transfer: { otherAccountId: string; pairWith: string | null; countsDespiteAnchor: boolean | null } | null;
  isEstimated: boolean;
  /**
   * true only where the person ticked "Include" on a possible duplicate. The
   * server re-runs the duplicate check and refuses a flagged row without it.
   */
  includeDuplicate: boolean;
  /** The answer to "Is this the same bill?" -- required where a row matches. */
  sameBill: { answer: "same" | "different"; recurringId: string; dueDate: string } | null;
};

export type ImportInput = {
  accountId: string;
  rows: ImportRowInput[];
  /** true = "No, add them to my balance"; false = "Yes, already counted"; null = not asked. */
  countsDespiteAnchor: boolean | null;
  /** One per attempt, so a retry can't write the batch twice. */
  idempotencyKey: string;
};

const BAD_SHAPE = "We couldn't read the rows for that import. Nothing was saved. Try choosing the file again.";

function validTransfer(r: ImportRowInput, accountId: string): boolean {
  const t = r.transfer;
  if (t === null) return typeof r.categoryId === "string" && UUID.test(r.categoryId);
  return (
    r.categoryId === null &&
    typeof t === "object" &&
    typeof t.otherAccountId === "string" &&
    UUID.test(t.otherAccountId) &&
    t.otherAccountId !== accountId &&
    (t.pairWith === null || (typeof t.pairWith === "string" && UUID.test(t.pairWith))) &&
    (t.countsDespiteAnchor === null || typeof t.countsDespiteAnchor === "boolean") &&
    // A joined row can't also take a schedule's occurrence (v1).
    !(t.pairWith !== null && r.sameBill !== null)
  );
}

function validShape(input: ImportInput): boolean {
  if (!UUID.test(input.accountId) || !UUID.test(input.idempotencyKey)) return false;
  if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > MAX_IMPORT_ROWS) return false;
  if (input.countsDespiteAnchor !== null && typeof input.countsDespiteAnchor !== "boolean") return false;
  const textOk = (v: string | null, max: number) => v === null || (typeof v === "string" && v.length <= max);
  const pairs = input.rows.flatMap((r) => (r.transfer?.pairWith ? [r.transfer.pairWith] : []));
  // An entry is joined to one row at most (the server locks and checks it too).
  if (new Set(pairs).size !== pairs.length) return false;
  return input.rows.every(
    (r) =>
      Number.isInteger(r.row) &&
      r.row >= 2 &&
      ISO.test(r.date) &&
      Number.isInteger(r.cents) &&
      r.cents >= 1 &&
      r.cents <= 999_999_999_999 &&
      (r.type === "Income" || r.type === "Expense") &&
      typeof r.description === "string" &&
      r.description.trim() !== "" &&
      r.description.length <= MAX_DESCRIPTION &&
      textOk(r.notes, MAX_NOTES) &&
      textOk(r.merchant, MAX_MERCHANT) &&
      textOk(r.paymentMethod, MAX_PAYMENT_METHOD) &&
      r.transfer !== undefined &&
      validTransfer(r, input.accountId) &&
      typeof r.isEstimated === "boolean" &&
      typeof r.includeDuplicate === "boolean" &&
      (r.sameBill === null ||
        ((r.sameBill.answer === "same" || r.sameBill.answer === "different") &&
          UUID.test(r.sameBill.recurringId) &&
          ISO.test(r.sameBill.dueDate))),
  );
}

export type ImportOutcome = { importId: string; rowCount: number };

/**
 * One atomic import. Before it, the server checks every "same bill" claim
 * against the queue as it stands NOW (the ids come from the browser): a row
 * that matches an occurrence must carry an answer, and an answer must be for
 * a match that still exists -- else nothing is written and the person
 * reviews the preview again. Then import_transactions() writes every row,
 * transfer leg, join, link and cursor move in one transaction, or none.
 */
export async function importTransactions(input: ImportInput): Promise<DbResult<ImportOutcome>> {
  if (!validShape(input)) return { data: null, error: BAD_SHAPE };

  // Possible duplicates, re-run here against what the account holds now. The
  // browser says which flagged rows the person ticked; it isn't trusted to
  // have flagged them. A flagged row without its tick refuses the import.
  const supabase = await createClient();
  const dates = input.rows.map((r) => r.date).sort();
  const existingRes = await readExisting(
    supabase,
    input.accountId,
    addDaysISO(dates[0], -DUPLICATE_WINDOW_DAYS),
    addDaysISO(dates[dates.length - 1], DUPLICATE_WINDOW_DAYS),
  );
  if (existingRes.error !== null) return { data: null, error: existingRes.error };
  const refused = unincludedDuplicates(
    input.rows.map((r) => ({ row: r.row, date: r.date, cents: r.cents, includeDuplicate: r.includeDuplicate })),
    existingRes.data,
  );
  if (refused.length > 0) return { data: null, error: IMPORT_DUPLICATES };

  const queueRes = await getConfirmationQueue();
  if (queueRes.error !== null) return { data: null, error: queueRes.error };
  const matches = findImportSameBill(sameBillRows(input.rows), importQueueItems(queueRes.data, input.accountId), input.accountId);
  const matchByRow = new Map(matches.map((m) => [m.row, m]));
  for (const r of input.rows) {
    const m = matchByRow.get(r.row);
    if (m === undefined && r.sameBill !== null) return { data: null, error: IMPORT_STALE };
    if (m !== undefined) {
      if (r.sameBill === null || r.sameBill.recurringId !== m.recurringId || r.sameBill.dueDate !== m.dueDate) {
        return { data: null, error: IMPORT_STALE };
      }
    }
  }

  const rows: Record<string, unknown>[] = [];
  for (const r of input.rows) {
    const base: Record<string, unknown> = {
      row: r.row,
      date: r.date,
      cents: r.cents,
      type: r.type,
      description: r.description,
      notes: r.notes,
      merchant: r.merchant,
      payment_method: r.paymentMethod,
      is_estimated: r.isEstimated,
    };
    if (r.transfer === null) {
      base.categoryid = r.categoryId;
    } else {
      base.transfer = {
        other_accountid: r.transfer.otherAccountId,
        pair_with: r.transfer.pairWith,
        counts_despite_anchor: r.transfer.countsDespiteAnchor,
      };
    }
    if (r.sameBill?.answer === "same") {
      const cycle = await getSameBillCycle(r.sameBill.recurringId, r.sameBill.dueDate);
      if (cycle.error !== null) return { data: null, error: cycle.error };
      if (cycle.data === null) return { data: null, error: IMPORT_STALE };
      base.same_bill = {
        recurringid: r.sameBill.recurringId,
        from_run_date: cycle.data.fromRunDate,
        to_run_date: cycle.data.toRunDate,
        to_due_date: cycle.data.toDueDate,
      };
    } else if (r.sameBill?.answer === "different") {
      base.different_bill = { recurringid: r.sameBill.recurringId, due_date: r.sameBill.dueDate };
    }
    rows.push(base);
  }

  const { data, error } = await supabase.rpc("import_transactions", {
    p_accountid: input.accountId,
    p_rows: rows as never,
    p_counts_despite_anchor: input.countsDespiteAnchor ?? undefined,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) return { data: null, error: describeImportError(error, "import") };
  const out = data[0];
  if (!out) return { data: null, error: IMPORT_GENERIC };
  return { data: { importId: out.out_import_id, rowCount: out.out_row_count }, error: null };
}

// ---------------------------------------------------------------------
// Past imports and undo
// ---------------------------------------------------------------------

export type ImportListItem = {
  importId: string;
  accountId: string;
  accountName: string;
  createdAt: string;
  rowCount: number;
  remainingCount: number;
  editedCount: number;
};

export async function listImports(): Promise<DbResult<ImportListItem[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_imports");
  if (error) return { data: null, error: describeReadError(error, "imports") };
  return {
    data: data.map((r) => ({
      importId: r.import_id,
      accountId: r.accountid,
      accountName: r.account_name,
      createdAt: r.created_at,
      rowCount: r.row_count,
      remainingCount: r.remaining_count,
      editedCount: r.edited_count,
    })),
    error: null,
  };
}

export type UndoPreview = {
  remaining: number;
  edited: number;
  /** Entries this import joined into a transfer: they go back to how they were (migration 76). */
  restored: number;
  /** What undoing does to each schedule a row was matched to (item 4's delete handling). */
  scheduleNotes: string[];
};

/** What "Undo this import" will do, said before it does it. */
export async function getUndoPreview(importId: string): Promise<DbResult<UndoPreview>> {
  if (!UUID.test(importId)) return { data: null, error: "We couldn't find that import." };
  const supabase = await createClient();
  const [listRes, idsRes, pairedRes] = await Promise.all([
    listImports(),
    supabase.from("transactions").select("id").eq("import_id", importId),
    supabase.from("import_pairings").select("id", { count: "exact", head: true }).eq("import_id", importId),
  ]);
  if (listRes.error !== null) return { data: null, error: listRes.error };
  if (idsRes.error) return { data: null, error: describeReadError(idsRes.error, "transactions") };
  if (pairedRes.error) return { data: null, error: describeReadError(pairedRes.error, "imports") };
  const item = listRes.data.find((i) => i.importId === importId);
  if (!item) return { data: null, error: "We couldn't find that import." };

  const previews = await getSameBillDeletePreviews(idsRes.data.map((r) => r.id));
  if (previews.error !== null) return { data: null, error: previews.error };
  return {
    data: {
      remaining: item.remainingCount,
      edited: item.editedCount,
      restored: pairedRes.count ?? 0,
      scheduleNotes: previews.data.map(sameBillDeleteNote),
    },
    error: null,
  };
}

export async function undoImport(importId: string): Promise<DbResult<{ deleted: number }>> {
  if (!UUID.test(importId)) return { data: null, error: "We couldn't find that import." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("undo_import", { p_import_id: importId });
  if (error) return { data: null, error: describeImportError(error, "undo") };
  return { data: { deleted: data[0]?.out_deleted ?? 0 }, error: null };
}

/** When a transaction was imported, for its "Imported 14 Nov" label; null if it wasn't. */
export async function getImportedAt(transactionId: string): Promise<DbResult<string | null>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("import_id, imports!transactions_import_fkey(created_at)")
    .eq("id", transactionId)
    .maybeSingle();
  if (error) return { data: null, error: describeReadError(error, "transaction") };
  if (!data || data.import_id === null) return { data: null, error: null };
  const imp = data.imports as { created_at: string } | { created_at: string }[] | null;
  const createdAt = Array.isArray(imp) ? imp[0]?.created_at : imp?.created_at;
  return { data: createdAt ?? null, error: null };
}

// "Imported through": the latest TRANSACTION date among each account's
// imported rows (import_id not null) -- not the import's created_at, because
// the question is which bank dates are covered. Derived on read: no column,
// and it recomputes after an Undo. An account never imported into is absent.
// Only rows from an import INTO that account count: a transfer's other leg,
// created on Savings by a Checking import, says nothing about which of the
// Savings bank's dates are covered (migration 76).
export async function getImportedThrough(accountIds: readonly string[]): Promise<DbResult<Map<string, string>>> {
  const supabase = await createClient();
  const found = new Map<string, string>();
  const results = await Promise.all(
    accountIds.map((id) =>
      supabase
        .from("transactions")
        .select("transaction_date, imports!transactions_import_fkey!inner(accountid)")
        .eq("accountid", id)
        .eq("imports.accountid", id)
        .not("import_id", "is", null)
        .order("transaction_date", { ascending: false })
        .limit(1)
        .maybeSingle()
        .then((res) => ({ id, res })),
    ),
  );
  for (const { id, res } of results) {
    if (res.error) return { data: null, error: describeReadError(res.error, "imports") };
    if (res.data) found.set(id, res.data.transaction_date);
  }
  return { data: found, error: null };
}
