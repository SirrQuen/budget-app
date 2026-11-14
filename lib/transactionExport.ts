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

/** sorrel-transactions-2026-11-14.csv, dated by the user's today. */
export function exportFileName(today: string): string {
  return `sorrel-transactions-${today}.csv`;
}
