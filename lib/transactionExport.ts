// The transaction export's file format -- pure, so it's tested without a
// database (lib/transactionExport.test.ts). The read lives in
// exportTransactions() (lib/db/transactions.ts); the download in
// app/(app)/settings/export/route.ts.
//
// THIS LAYOUT IS AN IMPORT FORMAT TOO. It will be the first format import
// reads, so a Sorrel export goes back in with nothing lost. That's why it
// carries ids beside names, the stored flags, and the exact amount text.
// Columns are only ever ADDED, at the end; never renamed, reordered or
// removed -- an older export must stay importable.
//
// Rules a reader of this file can rely on:
// - UTF-8 with a byte-order mark (so Excel reads accents), CRLF line
//   endings, RFC 4180 quoting.
// - One row per transaction row. A transfer is two rows sharing
//   transfer_group_id: the Expense leg (the source) and the Income leg
//   (the destination). Neither leg has a category.
// - `amount` is the exact numeric text from Postgres ("1850.00"), always
//   positive; direction is `type`. Never parsed through a float.
// - `date` is ISO YYYY-MM-DD, the transaction's calendar day.
// - Booleans are `true` / `false`. Blank means null (not asked, not set).
// - `counts_despite_balance_date` and `balance_date_answered_at` are the
//   stored answer to "was it already included in that balance?" and the
//   balance it answered (migration 62), exported as stored. Whether that
//   answer still applies is decided by anchor_includes() against the
//   account's current balance date -- never by this file.
// - Formula-injection guard: a text cell starting with = + - @ tab, CR or
//   an apostrophe gets one apostrophe in front, so a spreadsheet opens it
//   as text. An importer strips exactly one leading apostrophe from a text
//   cell; because an apostrophe at the start is itself guarded, that
//   reverses the guard exactly.

export const EXPORT_COLUMNS = [
  "id",
  "date",
  "account_id",
  "account",
  "type",
  "category_id",
  "category",
  "description",
  "amount",
  "notes",
  "merchant",
  "payment_method",
  "transfer_group_id",
  "is_estimated",
  "counts_despite_balance_date",
  "balance_date_answered_at",
] as const;

export type ExportColumn = (typeof EXPORT_COLUMNS)[number];

export type ExportRow = {
  id: string;
  transaction_date: string;
  accountid: string;
  account_name: string | null;
  transaction_type: string;
  categoryid: string | null;
  category_name: string | null;
  description: string;
  /** Exact numeric text from Postgres, e.g. "1850.00". */
  amount: string;
  notes: string | null;
  merchant: string | null;
  payment_method: string | null;
  transfer_group_id: string | null;
  is_estimated: boolean;
  counts_despite_anchor: boolean | null;
  anchor_answer_set_at: string | null;
};

const BOM = "﻿";
const EOL = "\r\n";

// OWASP's list for CSV injection, plus the apostrophe itself so the guard
// can be reversed exactly (see the header).
const FORMULA_LEAD = new Set(["=", "+", "-", "@", "\t", "\r", "'"]);

/** A text cell as a spreadsheet will open it: never as a formula. */
export function guardFormula(value: string): string {
  return value.length > 0 && FORMULA_LEAD.has(value[0]) ? `'${value}` : value;
}

/** RFC 4180: quote a field holding a comma, quote, CR or LF; double quotes. */
export function quoteField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const text = (value: string | null) => quoteField(guardFormula(value ?? ""));
const bool = (value: boolean | null) => (value === null ? "" : value ? "true" : "false");

// Only user-written text is guarded. Ids, dates, the type, the amount and
// booleans come from the database in fixed shapes; guarding them would
// change a value an importer must read back unaltered.
function rowCells(row: ExportRow): Record<ExportColumn, string> {
  return {
    id: row.id,
    date: row.transaction_date,
    account_id: row.accountid,
    account: text(row.account_name),
    type: row.transaction_type,
    category_id: row.categoryid ?? "",
    category: text(row.category_name),
    description: text(row.description),
    amount: row.amount,
    notes: text(row.notes),
    merchant: text(row.merchant),
    payment_method: text(row.payment_method),
    transfer_group_id: row.transfer_group_id ?? "",
    is_estimated: bool(row.is_estimated),
    counts_despite_balance_date: bool(row.counts_despite_anchor),
    balance_date_answered_at: row.anchor_answer_set_at ?? "",
  };
}

/** The whole file: BOM, header row, one line per row, each ending CRLF. */
export function buildTransactionsCsv(rows: ExportRow[]): string {
  const lines = [EXPORT_COLUMNS.join(",")];
  for (const row of rows) {
    const cells = rowCells(row);
    lines.push(EXPORT_COLUMNS.map((c) => cells[c]).join(","));
  }
  return BOM + lines.join(EOL) + EOL;
}


// ---------------------------------------------------------------------
// Filtered export: the filename and the button's label
// ---------------------------------------------------------------------

/**
 * What a filtered export is about, in words -- the file NAME carries it, never
 * a row inside the file (a metadata row would break import's recognition of
 * Sorrel's header). Names, not ids, for account and category.
 */
export type ExportScope = {
  accountName?: string | null;
  categoryName?: string | null;
  type?: "" | "Income" | "Expense";
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  /** Some filter is set, even if its name couldn't be read -- never named like the full export. */
  filtered?: boolean;
};

const MAX_SLUG = 40;

/** "Chase Checking ••1234" -> "chase-checking-1234": ASCII letters and digits only, so a header and a file system can't choke on it. */
export function slugForFileName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, "");
}

export function hasExportScope(scope: ExportScope): boolean {
  return Boolean(scope.filtered || scope.accountName || scope.categoryName || scope.type || scope.dateFrom || scope.dateTo || scope.q);
}

/**
 * No filters: sorrel-transactions-2026-11-14.csv (dated by today, as
 * Settings has always named it). Filtered, the filters name the file:
 * sorrel-checking-2026-11-01-to-2026-11-30.csv -- account, category, type,
 * the date range, then search text, each only when set.
 */
export function exportFileName(today: string, scope: ExportScope = {}): string {
  if (!hasExportScope(scope)) return `sorrel-transactions-${today}.csv`;
  const parts: string[] = [];
  const add = (v: string | null | undefined) => {
    const slug = v ? slugForFileName(v) : "";
    if (slug) parts.push(slug);
  };
  add(scope.accountName);
  add(scope.categoryName);
  if (scope.type) parts.push(scope.type.toLowerCase());
  if (scope.dateFrom && scope.dateTo) parts.push(`${scope.dateFrom}-to-${scope.dateTo}`);
  else if (scope.dateFrom) parts.push(`from-${scope.dateFrom}`);
  else if (scope.dateTo) parts.push(`to-${scope.dateTo}`);
  if (scope.q) {
    const slug = slugForFileName(scope.q);
    if (slug) parts.push(`search-${slug}`);
  }
  // Every filter was set but none survived slugging (a search of "???"):
  // still a filtered file, still dated, so it can't pose as the full export.
  if (parts.length === 0) parts.push("filtered", today);
  return `sorrel-${parts.join("-")}.csv`;
}

/** "Export all transactions" with no filters, else "Export 42 transactions" -- the count the list shows. */
export function exportLabel(filtered: boolean, count: number): string {
  if (!filtered) return "Export all transactions";
  return `Export ${count.toLocaleString("en-US")} ${count === 1 ? "transaction" : "transactions"}`;
}
