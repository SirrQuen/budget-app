// Reading a bank's CSV into transactions -- pure, so every rule is tested
// without a browser or a database (lib/importCsv.test.ts).
// docs/Import-CSV.md is the spec.
//
// The file is parsed in the browser and never leaves the device. What this
// file produces is rows for the PREVIEW; nothing here saves anything, and
// the only rows that ever reach the server are the ones a person confirmed
// there.
//
// Rules a reader can rely on:
// - Money is integer CENTS, parsed from text. Never a float, never summed
//   as one. Accepts "$1,234.56", "1234.56", "-12.00", "(12.00)". Anything
//   else -- "1.234,56", "12.345", "12 CR" -- is a row we couldn't read, not
//   a number we guessed.
// - Dates are never guessed. ISO dates, and a/b/yyyy once the file settles
//   which of a and b is the day (any value above 12). If every one is
//   ambiguous, the person is asked; this file reports that, it doesn't
//   choose.
// - Which way is money out is the person's answer for a one-column amount.
//   There is no default.
// - A row we can't read is listed with its row number -- never dropped,
//   never guessed. Row numbers are the spreadsheet's: the header is row 1.
// - Zero-amount rows are skipped and counted.

import { EXPORT_COLUMNS } from "@/lib/transactionExport";
import { addDaysISO } from "@/lib/date";

/** The server's limits (migration 68) and the browser's own, said once. */
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_DESCRIPTION = 500;
export const MAX_NOTES = 2000;
export const MAX_MERCHANT = 500;
export const MAX_PAYMENT_METHOD = 100;

/** A parsed file: records of cells, the header record first. */
export type Records = readonly (readonly string[])[];

export type DateOrder = "dmy" | "mdy";
/** Money you spent is shown as a negative number, or as a positive one. */
export type MoneyOut = "negative" | "positive";

// ---------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------

const AMOUNT_BODY = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{1,2}))?$/;

/**
 * Text to signed integer cents, or null when it isn't an amount we read.
 * The sign is whatever the text says; what it MEANS (money out or in) is
 * the caller's.
 */
export function parseAmountCents(raw: string): number | null {
  let t = raw.trim().replace(/−/g, "-"); // a typographic minus is a minus
  if (t === "") return null;

  let negative = false;
  let signs = 0;

  if (t.startsWith("(") && t.endsWith(")")) {
    negative = true;
    signs++;
    t = t.slice(1, -1).trim();
  }
  // A sign and a currency symbol, in either order: "-$12.00", "$-12.00".
  for (let i = 0; i < 2; i++) {
    if (t.startsWith("-")) {
      negative = true;
      signs++;
      t = t.slice(1).trim();
    } else if (t.startsWith("+")) {
      signs++;
      t = t.slice(1).trim();
    }
    if (t.startsWith("$")) t = t.slice(1).trim();
  }
  // "(-12.00)" and "--12" say two things; don't pick one.
  if (signs > 1) return null;

  const m = AMOUNT_BODY.exec(t);
  if (!m || t === "" || t === ".") return null;
  const whole = (m[1] ?? "").replace(/,/g, "");
  const frac = m[2] ?? "";
  if (whole === "" && frac === "") return null;
  // numeric(12,2) holds ten digits before the point.
  if (whole.length > 10) return null;

  const cents = Number(whole === "" ? "0" : whole) * 100 + Number(frac.padEnd(2, "0"));
  return negative && cents !== 0 ? -cents : cents;
}

// ---------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const ISO_SLASH_DATE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
const PART_DATE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoFrom(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Text to an ISO date, or null. ISO dates read the same whatever the
 * order; a/b/yyyy reads as `order` says. Two-digit years aren't read.
 */
export function parseDate(raw: string, order: DateOrder | null): string | null {
  const t = raw.trim();
  const iso = ISO_DATE.exec(t) ?? ISO_SLASH_DATE.exec(t);
  if (iso) return isoFrom(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const part = PART_DATE.exec(t);
  if (!part || order === null) return null;
  const a = Number(part[1]);
  const b = Number(part[2]);
  const y = Number(part[3]);
  return order === "dmy" ? isoFrom(y, b, a) : isoFrom(y, a, b);
}

export type DateFormatFinding =
  /** Nothing in the file needs an order (all ISO, or none read as a/b/yyyy). */
  | { kind: "settled"; order: DateOrder | null }
  /** Day/month/year or month/day/year, decided by the file itself. */
  | { kind: "decided"; order: DateOrder }
  /** Every a/b/yyyy date could be read both ways: ask, with a real example. */
  | { kind: "ambiguous"; example: string }
  /** One row proves day-first, another month-first. */
  | { kind: "mixed" };

/**
 * What the file's own dates say about their order. A value from 13 to 31 in
 * the first place proves day-first; in the second, month-first. Dates whose
 * two parts are equal (05/05/2026) read the same either way and prove
 * nothing, nor do they need asking about.
 */
export function detectDateOrder(rawDates: readonly string[]): DateFormatFinding {
  let dayFirst = false;
  let monthFirst = false;
  let example: string | null = null;
  let anyPart = false;

  for (const raw of rawDates) {
    const m = PART_DATE.exec(raw.trim());
    if (!m) continue;
    anyPart = true;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a >= 13 && a <= 31) dayFirst = true;
    if (b >= 13 && b <= 31) monthFirst = true;
    if (example === null && a >= 1 && a <= 12 && b >= 1 && b <= 12 && a !== b) example = raw.trim();
  }

  if (!anyPart) return { kind: "settled", order: null };
  if (dayFirst && monthFirst) return { kind: "mixed" };
  if (dayFirst) return { kind: "decided", order: "dmy" };
  if (monthFirst) return { kind: "decided", order: "mdy" };
  if (example === null) return { kind: "settled", order: "dmy" }; // every date reads the same both ways
  return { kind: "ambiguous", example };
}

/** The earliest and latest dates the server accepts (migration 68). */
export function dateInRange(iso: string, today: string): boolean {
  return iso >= "1970-01-01" && iso <= addDaysISO(today, 365);
}

// ---------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------

function normalizeHeader(h: string): string {
  return h.replace(/^﻿/, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Sorrel's own export, recognised by its exact headers (docs/Import-CSV.md). */
export function isSorrelExport(header: readonly string[]): boolean {
  return EXPORT_COLUMNS.every((name, i) => (header[i] ?? "").replace(/^﻿/, "").trim() === name);
}

export type ColumnGuess = {
  date: number | null;
  description: number | null;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  category: number | null;
  notes: number | null;
};

const NAMES = {
  date: ["date", "transaction date", "trans date", "posted date", "posted", "posting date", "post date", "booking date"],
  description: ["description", "transaction description", "original description", "details", "memo", "payee", "narrative", "merchant", "name", "transaction"],
  amount: ["amount", "transaction amount", "amt", "value"],
  debit: ["debit", "debits", "debit amount", "withdrawal", "withdrawals", "money out", "paid out"],
  credit: ["credit", "credits", "credit amount", "deposit", "deposits", "money in", "paid in"],
  category: ["category", "categories"],
  notes: ["notes", "note", "comment", "comments"],
} as const;

/** A guess from common header names, for the person to correct. Never final. */
export function guessColumns(header: readonly string[]): ColumnGuess {
  const normalized = header.map(normalizeHeader);
  const used = new Set<number>();
  const find = (names: readonly string[]): number | null => {
    for (const name of names) {
      const i = normalized.findIndex((h, idx) => h === name && !used.has(idx));
      if (i !== -1) {
        used.add(i);
        return i;
      }
    }
    return null;
  };
  return {
    date: find(NAMES.date),
    description: find(NAMES.description),
    amount: find(NAMES.amount),
    debit: find(NAMES.debit),
    credit: find(NAMES.credit),
    category: find(NAMES.category),
    notes: find(NAMES.notes),
  };
}

export type AmountShape =
  | { kind: "signed"; column: number }
  | { kind: "split"; debit: number; credit: number };

export type ColumnMap = {
  date: number;
  description: number;
  amount: AmountShape;
  category: number | null;
  notes: number | null;
};

// ---------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------

export type ImportType = "Income" | "Expense";

export type ReadRow = {
  /** The spreadsheet's row number: the header is row 1. */
  row: number;
  date: string;
  /** Positive. The direction is `type`. */
  cents: number;
  type: ImportType;
  description: string;
  notes: string | null;
  categoryName: string | null;
  rawDate: string;
  rawAmount: string;
  // Sorrel's own export carries these back.
  merchant: string | null;
  paymentMethod: string | null;
  isEstimated: boolean;
  /** Own export only: which account's row it is (account_id, else the name). */
  accountKey: string | null;
};

export type UnreadableRow = {
  row: number;
  rawDate: string;
  rawAmount: string;
  /** Neutral, short: "Date not recognised". */
  reason: string;
};

export type ReadResult = {
  rows: ReadRow[];
  unreadable: UnreadableRow[];
  zeroSkipped: number;
  /** Own export only: transfer legs, counted and left out (v1 has no transfers). */
  transfersSkipped: number;
};

const cell = (record: readonly string[], i: number | null): string => (i === null ? "" : (record[i] ?? ""));
const isBlank = (record: readonly string[]) => record.every((c) => c.trim() === "");

/** How many data records the file holds (the header and blank lines excluded). */
export function countDataRecords(records: Records): number {
  let n = 0;
  for (let i = 1; i < records.length; i++) if (!isBlank(records[i])) n++;
  return n;
}

export type ReadOptions = {
  /** The user's today -- the date range the server accepts is relative to it. */
  today: string;
  order: DateOrder | null;
};

/**
 * Money out shown as negative: a negative cell is spending (Expense), a
 * positive one is money in. "positive" is the mirror. Never decided here.
 */
export function directionFor(signedCents: number, moneyOut: MoneyOut): ImportType {
  const spent = moneyOut === "negative" ? signedCents < 0 : signedCents > 0;
  return spent ? "Expense" : "Income";
}

/** The first row with an amount and a description -- the example the question shows. */
export function moneyOutExample(
  records: Records,
  amountColumn: number,
  descriptionColumn: number,
): { description: string; rawAmount: string } | null {
  for (let i = 1; i < records.length; i++) {
    const rawAmount = cell(records[i], amountColumn).trim();
    const description = cell(records[i], descriptionColumn).trim();
    const cents = parseAmountCents(rawAmount);
    if (cents !== null && cents !== 0 && description !== "") return { description, rawAmount };
  }
  return null;
}

type Pending = {
  rows: ReadRow[];
  unreadable: UnreadableRow[];
  zeroSkipped: number;
  transfersSkipped: number;
};

const fail = (p: Pending, row: number, rawDate: string, rawAmount: string, reason: string) =>
  p.unreadable.push({ row, rawDate, rawAmount, reason });

/**
 * Any file but Sorrel's own. `moneyOut` is required for a one-column
 * amount and ignored for Debit/Credit columns (a debit is money out).
 */
export function readRows(
  records: Records,
  map: ColumnMap,
  moneyOut: MoneyOut | null,
  opts: ReadOptions,
): ReadResult {
  const p: Pending = { rows: [], unreadable: [], zeroSkipped: 0, transfersSkipped: 0 };

  for (let i = 1; i < records.length; i++) {
    const rec = records[i];
    if (isBlank(rec)) continue;
    const row = i + 1;
    const rawDate = cell(rec, map.date).trim();

    let rawAmount: string;
    let cents: number | null;
    let type: ImportType | null = null;

    if (map.amount.kind === "signed") {
      rawAmount = cell(rec, map.amount.column).trim();
      cents = parseAmountCents(rawAmount);
      if (cents === null) {
        fail(p, row, rawDate, rawAmount, rawAmount === "" ? "Amount missing" : "Amount not recognised");
        continue;
      }
      if (moneyOut === null) {
        // The caller must have asked. Refusing to guess is the rule.
        fail(p, row, rawDate, rawAmount, "Which way money goes hasn't been answered");
        continue;
      }
      if (cents !== 0) type = directionFor(cents, moneyOut);
    } else {
      const rawDebit = cell(rec, map.amount.debit).trim();
      const rawCredit = cell(rec, map.amount.credit).trim();
      rawAmount = [rawDebit, rawCredit].filter((s) => s !== "").join(" / ");
      const debit = rawDebit === "" ? null : parseAmountCents(rawDebit);
      const credit = rawCredit === "" ? null : parseAmountCents(rawCredit);
      if ((rawDebit !== "" && debit === null) || (rawCredit !== "" && credit === null)) {
        fail(p, row, rawDate, rawAmount, "Amount not recognised");
        continue;
      }
      const debitCents = Math.abs(debit ?? 0);
      const creditCents = Math.abs(credit ?? 0);
      if (debitCents !== 0 && creditCents !== 0) {
        fail(p, row, rawDate, rawAmount, "Both Debit and Credit have an amount");
        continue;
      }
      if (rawDebit === "" && rawCredit === "") {
        fail(p, row, rawDate, rawAmount, "Amount missing");
        continue;
      }
      cents = debitCents !== 0 ? debitCents : creditCents;
      if (cents !== 0) type = debitCents !== 0 ? "Expense" : "Income";
    }

    const date = parseDate(rawDate, opts.order);
    if (date === null) {
      fail(p, row, rawDate, rawAmount, rawDate === "" ? "Date missing" : "Date not recognised");
      continue;
    }
    if (!dateInRange(date, opts.today)) {
      fail(p, row, rawDate, rawAmount, "Date is out of range");
      continue;
    }

    const description = cell(rec, map.description).trim();
    if (description === "") {
      fail(p, row, rawDate, rawAmount, "No description");
      continue;
    }
    if (description.length > MAX_DESCRIPTION) {
      fail(p, row, rawDate, rawAmount, "Description is too long");
      continue;
    }
    const notes = cell(rec, map.notes).trim();
    if (notes.length > MAX_NOTES) {
      fail(p, row, rawDate, rawAmount, "Notes are too long");
      continue;
    }

    if (cents === 0 || type === null) {
      p.zeroSkipped++;
      continue;
    }

    p.rows.push({
      row,
      date,
      cents: Math.abs(cents),
      type,
      description,
      notes: notes === "" ? null : notes,
      categoryName: cell(rec, map.category).trim() || null,
      rawDate,
      rawAmount,
      merchant: null,
      paymentMethod: null,
      isEstimated: false,
      accountKey: null,
    });
  }
  return p;
}

// ---------------------------------------------------------------------
// Sorrel's own export
// ---------------------------------------------------------------------

/**
 * One text cell of Sorrel's export, back as typed. The export guards a cell
 * that starts with = + - @ tab, CR or an apostrophe with ONE apostrophe in
 * front (lib/transactionExport.ts); an importer strips exactly one, which
 * reverses it exactly.
 */
export function unguardFormula(value: string): string {
  return value.startsWith("'") ? value.slice(1) : value;
}

const col = (name: (typeof EXPORT_COLUMNS)[number]) => EXPORT_COLUMNS.indexOf(name);

export type ExportAccount = {
  /** account_id, else "name:<name>". */
  key: string;
  id: string | null;
  name: string;
  /** Rows of this account that aren't transfer legs. */
  count: number;
};

function accountKeyOf(rec: readonly string[]): { key: string; id: string | null; name: string } {
  const id = cell(rec, col("account_id")).trim();
  const name = unguardFormula(cell(rec, col("account"))).trim();
  return { key: id !== "" ? id : `name:${name}`, id: id !== "" ? id : null, name };
}

/** The accounts a Sorrel export holds, so the person says which one this is. */
export function accountsInExport(records: Records): ExportAccount[] {
  const byKey = new Map<string, ExportAccount>();
  for (let i = 1; i < records.length; i++) {
    const rec = records[i];
    if (isBlank(rec)) continue;
    const a = accountKeyOf(rec);
    const isTransfer = cell(rec, col("transfer_group_id")).trim() !== "";
    const found = byKey.get(a.key) ?? { key: a.key, id: a.id, name: a.name, count: 0 };
    if (!isTransfer) found.count++;
    byKey.set(a.key, found);
  }
  return [...byKey.values()].sort((x, y) => x.name.localeCompare(y.name));
}

/**
 * Which of the file's accounts maps to the chosen one: the same account_id,
 * else the exact same name, else nothing -- the person picks.
 */
export function preselectExportAccount(
  inFile: readonly ExportAccount[],
  chosen: { id: string; name: string },
): string | null {
  const byId = inFile.find((a) => a.id === chosen.id);
  if (byId) return byId.key;
  const byName = inFile.find((a) => a.name === chosen.name);
  return byName ? byName.key : null;
}

/** Sorrel's own export: no mapping, no sign question, transfers left out. */
export function readSorrelExport(records: Records, opts: Pick<ReadOptions, "today">): ReadResult {
  const p: Pending = { rows: [], unreadable: [], zeroSkipped: 0, transfersSkipped: 0 };

  for (let i = 1; i < records.length; i++) {
    const rec = records[i];
    if (isBlank(rec)) continue;
    const row = i + 1;
    const rawDate = cell(rec, col("date")).trim();
    const rawAmount = cell(rec, col("amount")).trim();

    if (cell(rec, col("transfer_group_id")).trim() !== "") {
      p.transfersSkipped++;
      continue;
    }

    const date = parseDate(rawDate, null);
    if (date === null) {
      fail(p, row, rawDate, rawAmount, rawDate === "" ? "Date missing" : "Date not recognised");
      continue;
    }
    if (!dateInRange(date, opts.today)) {
      fail(p, row, rawDate, rawAmount, "Date is out of range");
      continue;
    }

    const cents = parseAmountCents(rawAmount);
    if (cents === null || cents < 0) {
      fail(p, row, rawDate, rawAmount, rawAmount === "" ? "Amount missing" : "Amount not recognised");
      continue;
    }

    const type = cell(rec, col("type")).trim();
    if (type !== "Income" && type !== "Expense") {
      fail(p, row, rawDate, rawAmount, "Type not recognised");
      continue;
    }

    const description = unguardFormula(cell(rec, col("description"))).trim();
    if (description === "") {
      fail(p, row, rawDate, rawAmount, "No description");
      continue;
    }
    const text = (name: (typeof EXPORT_COLUMNS)[number]) => {
      const v = unguardFormula(cell(rec, col(name))).trim();
      return v === "" ? null : v;
    };
    const notes = text("notes");
    const merchant = text("merchant");
    const paymentMethod = text("payment_method");
    if (
      description.length > MAX_DESCRIPTION ||
      (notes?.length ?? 0) > MAX_NOTES ||
      (merchant?.length ?? 0) > MAX_MERCHANT ||
      (paymentMethod?.length ?? 0) > MAX_PAYMENT_METHOD
    ) {
      fail(p, row, rawDate, rawAmount, "A text field is too long");
      continue;
    }

    if (cents === 0) {
      p.zeroSkipped++;
      continue;
    }

    p.rows.push({
      row,
      date,
      cents,
      type,
      description,
      notes,
      categoryName: text("category"),
      rawDate,
      rawAmount,
      merchant,
      paymentMethod,
      isEstimated: cell(rec, col("is_estimated")).trim() === "true",
      accountKey: accountKeyOf(rec).key,
    });
  }
  return p;
}
