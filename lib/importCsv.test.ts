import { test } from "node:test";
import assert from "node:assert/strict";
import Papa from "papaparse";
import {
  accountsInExport,
  countDataRecords,
  detectDateOrder,
  guessColumns,
  isSorrelExport,
  moneyOutExample,
  parseAmountCents,
  parseDate,
  preselectExportAccount,
  readRows,
  readSorrelExport,
  unguardFormula,
  type ColumnMap,
} from "./importCsv";
import { buildTransactionsCsv, EXPORT_COLUMNS, type ExportRow } from "./transactionExport";

const TODAY = "2026-11-14";

// ---- amounts -------------------------------------------------------

test("amounts: every accepted shape, in integer cents", () => {
  assert.equal(parseAmountCents("$1,234.56"), 123456);
  assert.equal(parseAmountCents("1234.56"), 123456);
  assert.equal(parseAmountCents("-12.00"), -1200);
  assert.equal(parseAmountCents("(12.00)"), -1200);
  assert.equal(parseAmountCents("−5.75"), -575); // a typographic minus
  assert.equal(parseAmountCents("12"), 1200);
  assert.equal(parseAmountCents("12.5"), 1250);
  assert.equal(parseAmountCents(".5"), 50);
  assert.equal(parseAmountCents("-$12.00"), -1200);
  assert.equal(parseAmountCents("$-12.00"), -1200);
  assert.equal(parseAmountCents("+7.10"), 710);
  assert.equal(parseAmountCents("0.00"), 0);
  assert.equal(parseAmountCents("-0.00"), 0);
  assert.equal(parseAmountCents(" 1,000 "), 100000);
});

test("amounts: a float never decides a cent", () => {
  // 0.1 + 0.2 style traps: each is read from its text.
  assert.equal(parseAmountCents("0.29"), 29);
  assert.equal(parseAmountCents("1.15"), 115);
  assert.equal(parseAmountCents("19.99"), 1999);
  assert.equal(parseAmountCents("8.20"), 820);
});

test("amounts: what we don't read, we say so", () => {
  for (const bad of ["1.234,56", "12.345", "12 CR", "€12.00", "abc", "", "  ", ".", "1,23", "(-12.00)", "--5", "12-", "1e3", "12,5"]) {
    assert.equal(parseAmountCents(bad), null, bad);
  }
  assert.equal(parseAmountCents("12345678901.00"), null); // past numeric(12,2)
});

// ---- dates ---------------------------------------------------------

test("dates: ISO needs no order, and a real calendar day", () => {
  assert.equal(parseDate("2026-03-04", null), "2026-03-04");
  assert.equal(parseDate("2026/3/4", null), "2026-03-04");
  assert.equal(parseDate("2026-02-30", null), null);
  assert.equal(parseDate("2026-13-01", null), null);
  assert.equal(parseDate("2024-02-29", null), "2024-02-29");
  assert.equal(parseDate("2026-02-29", null), null);
});

test("dates: a/b/yyyy reads as the order says, never without one", () => {
  assert.equal(parseDate("03/04/2026", "dmy"), "2026-04-03");
  assert.equal(parseDate("03/04/2026", "mdy"), "2026-03-04");
  assert.equal(parseDate("03/04/2026", null), null);
  assert.equal(parseDate("3-4-2026", "mdy"), "2026-03-04");
  assert.equal(parseDate("3.4.2026", "dmy"), "2026-04-03");
  assert.equal(parseDate("03/04/26", "dmy"), null); // two-digit years aren't read
  assert.equal(parseDate("31/04/2026", "dmy"), null);
});

test("03/04/2026 with no other clue asks; 13/04/2026 doesn't", () => {
  const ask = detectDateOrder(["03/04/2026", "05/06/2026", "11/12/2026"]);
  assert.deepEqual(ask, { kind: "ambiguous", example: "03/04/2026" });

  assert.deepEqual(detectDateOrder(["03/04/2026", "13/04/2026"]), { kind: "decided", order: "dmy" });
  assert.deepEqual(detectDateOrder(["03/04/2026", "04/13/2026"]), { kind: "decided", order: "mdy" });
  assert.deepEqual(detectDateOrder(["13/04/2026", "04/13/2026"]), { kind: "mixed" });
});

test("dates: ISO dates and equal parts need no question", () => {
  assert.deepEqual(detectDateOrder(["2026-03-04", "2026-03-05"]), { kind: "settled", order: null });
  // 05/05/2026 reads the same both ways: nothing to ask.
  assert.deepEqual(detectDateOrder(["05/05/2026", "06/06/2026"]), { kind: "settled", order: "dmy" });
  // The ambiguous example is a date that does differ.
  assert.deepEqual(detectDateOrder(["05/05/2026", "03/04/2026"]), { kind: "ambiguous", example: "03/04/2026" });
});

// ---- columns -------------------------------------------------------

test("columns: guessed from common names, left for the person to correct", () => {
  assert.deepEqual(guessColumns(["Transaction Date", "Description", "Amount", "Category"]), {
    date: 0, description: 1, amount: 2, debit: null, credit: null, category: 3, notes: null,
  });
  assert.deepEqual(guessColumns(["Date", "Payee", "Withdrawals", "Deposits", "Note"]), {
    date: 0, description: 1, amount: null, debit: 2, credit: 3, category: null, notes: 4,
  });
  assert.equal(guessColumns(["x", "y"]).date, null);
});

// ---- rows ----------------------------------------------------------

const MAP: ColumnMap = { date: 0, description: 1, amount: { kind: "signed", column: 2 }, category: null, notes: null };

function csv(text: string) {
  return Papa.parse(text, { skipEmptyLines: false }).data;
}

test("positive-means-spent and negative-means-spent files produce identical transactions", () => {
  const negative = csv("Date,Description,Amount\n2026-11-01,STARBUCKS,-5.75\n2026-11-02,PAYROLL,2000.00\n2026-11-03,RENT,-1850.00\n");
  const positive = csv("Date,Description,Amount\n2026-11-01,STARBUCKS,5.75\n2026-11-02,PAYROLL,-2000.00\n2026-11-03,RENT,1850.00\n");
  const a = readRows(negative, MAP, "negative", { today: TODAY, order: null });
  const b = readRows(positive, MAP, "positive", { today: TODAY, order: null });
  // The raw amount text differs by design (it's the sign convention under test).
  const strip = (r: typeof a) => r.rows.map((x) => ({ ...x, rawAmount: "" }));
  assert.deepEqual(strip(a), strip(b));
  assert.deepEqual(a.rows.map((r) => [r.type, r.cents]), [["Expense", 575], ["Income", 200000], ["Expense", 185000]]);
});

test("the wrong answer flips every row -- which is why it's asked, and shown", () => {
  const records = csv("Date,Description,Amount\n2026-11-01,STARBUCKS,-5.75\n");
  assert.equal(readRows(records, MAP, "negative", { today: TODAY, order: null }).rows[0].type, "Expense");
  assert.equal(readRows(records, MAP, "positive", { today: TODAY, order: null }).rows[0].type, "Income");
});

test("without an answer to which way money goes, a one-column file reads nothing", () => {
  const records = csv("Date,Description,Amount\n2026-11-01,STARBUCKS,-5.75\n");
  const r = readRows(records, MAP, null, { today: TODAY, order: null });
  assert.equal(r.rows.length, 0);
  assert.equal(r.unreadable.length, 1);
});

test("debit and credit columns need no sign question", () => {
  const records = csv("Date,Description,Debit,Credit\n2026-11-01,COFFEE,5.75,\n2026-11-02,PAY,,2000.00\n2026-11-03,BOTH,1.00,1.00\n2026-11-04,NONE,,\n2026-11-05,ZERO,0.00,\n");
  const r = readRows(records, { date: 0, description: 1, amount: { kind: "split", debit: 2, credit: 3 }, category: null, notes: null }, null, { today: TODAY, order: null });
  assert.deepEqual(r.rows.map((x) => [x.type, x.cents]), [["Expense", 575], ["Income", 200000]]);
  assert.deepEqual(r.unreadable.map((u) => [u.row, u.reason]), [[4, "Both Debit and Credit have an amount"], [5, "Amount missing"]]);
  assert.equal(r.zeroSkipped, 1);
});

test("unreadable rows are listed by row number with their raw text, never dropped or guessed", () => {
  const records = csv(
    [
      "Date,Description,Amount",
      "2026-11-01,OK ONE,-1.00",
      "not a date,BAD DATE,-2.00",
      "2026-11-03,BAD AMOUNT,1.234,56",
      "2026-11-04,EURO,\"1.234,56\"",
      "2026-11-05,,-3.00",
      "",
      "2026-11-06,OK TWO,-4.00",
      "1969-12-31,TOO OLD,-5.00",
      "2028-01-01,TOO FAR,-6.00",
    ].join("\n"),
  );
  const r = readRows(records, MAP, "negative", { today: TODAY, order: null });
  assert.deepEqual(r.rows.map((x) => x.row), [2, 8]); // the blank line is row 7 and is just blank
  assert.deepEqual(
    r.unreadable.map((u) => [u.row, u.reason, u.rawDate, u.rawAmount]),
    [
      [3, "Date not recognised", "not a date", "-2.00"],
      [4, "Amount not recognised", "2026-11-03", "1.234"], // an unquoted comma split the cell
      [5, "Amount not recognised", "2026-11-04", "1.234,56"],
      [6, "No description", "2026-11-05", "-3.00"],
      [9, "Date is out of range", "1969-12-31", "-5.00"],
      [10, "Date is out of range", "2028-01-01", "-6.00"],
    ],
  );
  // Every record is accounted for: read + unreadable + the blank.
  assert.equal(r.rows.length + r.unreadable.length, countDataRecords(records));
});

test("zero-amount rows are skipped and counted", () => {
  const records = csv("Date,Description,Amount\n2026-11-01,A,0.00\n2026-11-02,B,-0.00\n2026-11-03,C,-1.00\n");
  const r = readRows(records, MAP, "negative", { today: TODAY, order: null });
  assert.equal(r.zeroSkipped, 2);
  assert.equal(r.rows.length, 1);
});

test("a/b/yyyy dates are read only once an order is known", () => {
  const records = csv("Date,Description,Amount\n03/04/2026,A,-1.00\n");
  assert.equal(readRows(records, MAP, "negative", { today: TODAY, order: null }).rows.length, 0);
  assert.equal(readRows(records, MAP, "negative", { today: TODAY, order: "mdy" }).rows[0].date, "2026-03-04");
  assert.equal(readRows(records, MAP, "negative", { today: TODAY, order: "dmy" }).rows[0].date, "2026-04-03");
});

test("the money-out question shows a real row from the file", () => {
  const records = csv("Date,Description,Amount\n2026-11-01,ZERO,0.00\n2026-11-02,STARBUCKS 1234,-5.75\n");
  assert.deepEqual(moneyOutExample(records, 2, 1), { description: "STARBUCKS 1234", rawAmount: "-5.75" });
  assert.equal(moneyOutExample(csv("Date,Description,Amount\n"), 2, 1), null);
});

// ---- Sorrel's own export -------------------------------------------

function exportRow(over: Partial<ExportRow>): ExportRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    transaction_date: "2026-11-02",
    accountid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    account_name: "Checking",
    transaction_type: "Expense",
    categoryid: null,
    category_name: null,
    description: "Coffee",
    amount: "5.75",
    notes: null,
    merchant: null,
    payment_method: null,
    transfer_group_id: null,
    is_estimated: false,
    counts_despite_anchor: null,
    anchor_answer_set_at: null,
    ...over,
  };
}

test("Sorrel's own export is recognised by its exact headers", () => {
  assert.equal(isSorrelExport([...EXPORT_COLUMNS]), true);
  assert.equal(isSorrelExport(["﻿id", ...EXPORT_COLUMNS.slice(1)]), true);
  // Columns are only ever added at the end.
  assert.equal(isSorrelExport([...EXPORT_COLUMNS, "a_future_column"]), true);
  assert.equal(isSorrelExport(["Date", "Description", "Amount"]), false);
  assert.equal(isSorrelExport(EXPORT_COLUMNS.slice(0, 5)), false);
  assert.equal(isSorrelExport(["date", ...EXPORT_COLUMNS.slice(1)]), false);
});

test("a Sorrel export reads back: guarded text restored, transfers counted and left out", () => {
  const text = buildTransactionsCsv([
    exportRow({}),
    exportRow({ id: "2", description: "=SUM(A1)", notes: "+note", amount: "1850.00", transaction_type: "Income", category_name: "Pay", is_estimated: true }),
    exportRow({ id: "3", description: "Rent, \"June\"", merchant: "Landlord", payment_method: "ACH", account_name: "Savings", accountid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
    exportRow({ id: "4", description: "Move", transfer_group_id: "99999999-9999-4999-8999-999999999999" }),
  ]).replace(/^﻿/, "");
  const records = Papa.parse(text, { skipEmptyLines: false }).data;

  const r = readSorrelExport(records, { today: TODAY });
  assert.equal(r.transfersSkipped, 1);
  assert.equal(r.unreadable.length, 0);
  assert.deepEqual(
    r.rows.map((x) => [x.row, x.date, x.type, x.cents, x.description, x.notes, x.categoryName, x.isEstimated, x.merchant, x.paymentMethod]),
    [
      [2, "2026-11-02", "Expense", 575, "Coffee", null, null, false, null, null],
      [3, "2026-11-02", "Income", 185000, "=SUM(A1)", "+note", "Pay", true, null, null],
      [4, "2026-11-02", "Expense", 575, 'Rent, "June"', null, null, false, "Landlord", "ACH"],
    ],
  );

  const accounts = accountsInExport(records);
  assert.deepEqual(accounts.map((a) => [a.name, a.count]), [["Checking", 2], ["Savings", 1]]);
});

test("which file account maps to the chosen one: id, else exact name, else nothing", () => {
  const inFile = [
    { key: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Checking", count: 3 },
    { key: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Savings", count: 1 },
  ];
  assert.equal(preselectExportAccount(inFile, { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Whatever" }), inFile[1].key);
  assert.equal(preselectExportAccount(inFile, { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Checking" }), inFile[0].key);
  assert.equal(preselectExportAccount(inFile, { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "checking" }), null);
  assert.equal(preselectExportAccount(inFile, { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Joint" }), null);
});

test("an export's guard is undone exactly once", () => {
  assert.equal(unguardFormula("'=SUM(A1)"), "=SUM(A1)");
  assert.equal(unguardFormula("''quoted"), "'quoted");
  assert.equal(unguardFormula("plain"), "plain");
});

test("export rows with a bad type or a negative amount are listed, not guessed", () => {
  const header = [...EXPORT_COLUMNS].join(",");
  const line = (type: string, amount: string) =>
    ["id", "2026-11-02", "a", "Checking", type, "", "", "X", amount, "", "", "", "", "false", "", ""].join(",");
  const records = Papa.parse([header, line("Transfer", "5.00"), line("Expense", "-5.00"), line("Expense", "5.00")].join("\n"), { skipEmptyLines: false }).data;
  const r = readSorrelExport(records, { today: TODAY });
  assert.deepEqual(r.unreadable.map((u) => [u.row, u.reason]), [[2, "Type not recognised"], [3, "Amount not recognised"]]);
  assert.equal(r.rows.length, 1);
});
