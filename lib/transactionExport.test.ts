import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTransactionsCsv,
  EXPORT_COLUMNS,
  exportFileName,
  guardFormula,
  quoteField,
  type ExportRow,
} from "./transactionExport";

const base: ExportRow = {
  id: "11111111-1111-1111-1111-111111111111",
  transaction_date: "2026-11-01",
  accountid: "22222222-2222-2222-2222-222222222222",
  account_name: "Checking",
  transaction_type: "Expense",
  categoryid: "33333333-3333-3333-3333-333333333333",
  category_name: "Rent",
  description: "November rent",
  amount: "1850.00",
  notes: null,
  merchant: null,
  payment_method: null,
  transfer_group_id: null,
  is_estimated: false,
  counts_despite_anchor: null,
  anchor_answer_set_at: null,
};

// Splits a file with no quoted newlines into cells. Enough for these rows.
function lines(csv: string): string[] {
  return csv.slice(1).split("\r\n").slice(0, -1);
}

test("the file starts with a UTF-8 byte-order mark and ends with CRLF", () => {
  const csv = buildTransactionsCsv([base]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.endsWith("\r\n"));
  assert.ok(!/[^\r]\n/.test(csv), "every line break is CRLF");
});

test("the header is the column list, in order", () => {
  const [header] = lines(buildTransactionsCsv([]));
  assert.equal(header, EXPORT_COLUMNS.join(","));
});

// The order is the import format's contract: columns are only ever added
// at the end. If this fails because a column was inserted, renamed or
// removed, older exports stop importing -- add new ones at the end instead.
test("the column order is fixed", () => {
  assert.deepEqual(EXPORT_COLUMNS.slice(0, 16), [
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
  ]);
});

test("a plain row: ISO date, exact amount text, blanks for nulls", () => {
  const [, row] = lines(buildTransactionsCsv([base]));
  assert.equal(
    row,
    [
      base.id,
      "2026-11-01",
      base.accountid,
      "Checking",
      "Expense",
      base.categoryid,
      "Rent",
      "November rent",
      "1850.00",
      "",
      "",
      "",
      "",
      "false",
      "",
      "",
    ].join(","),
  );
});

test("the amount is written exactly as Postgres gave it", () => {
  const [, row] = lines(buildTransactionsCsv([{ ...base, amount: "0.10" }]));
  assert.equal(row.split(",")[8], "0.10");
});

test("both legs of a transfer share the group id and carry no category", () => {
  const group = "44444444-4444-4444-4444-444444444444";
  const leg = { ...base, categoryid: null, category_name: null, transfer_group_id: group };
  const [, out, into] = lines(
    buildTransactionsCsv([
      { ...leg, transaction_type: "Expense" },
      { ...leg, transaction_type: "Income", accountid: "55555555-5555-5555-5555-555555555555", account_name: "Visa" },
    ]),
  );
  for (const row of [out, into]) {
    const cells = row.split(",");
    assert.equal(cells[5], "");
    assert.equal(cells[6], "");
    assert.equal(cells[12], group);
  }
});

test("the stored balance-date answer and its anchor are exported as stored", () => {
  const [, row] = lines(
    buildTransactionsCsv([
      { ...base, is_estimated: true, counts_despite_anchor: true, anchor_answer_set_at: "2026-11-03T14:02:11.5+00:00" },
    ]),
  );
  const cells = row.split(",");
  assert.equal(cells[13], "true");
  assert.equal(cells[14], "true");
  assert.equal(cells[15], "2026-11-03T14:02:11.5+00:00");
});

test("an answer of 'yes, already counted' exports as false, not blank", () => {
  const [, row] = lines(
    buildTransactionsCsv([{ ...base, counts_despite_anchor: false, anchor_answer_set_at: "2026-11-03T14:02:11+00:00" }]),
  );
  assert.equal(row.split(",")[14], "false");
});

test("formula injection: every dangerous lead character is guarded", () => {
  for (const lead of ["=", "+", "-", "@", "\t", "\r", "'"]) {
    assert.equal(guardFormula(`${lead}x`), `'${lead}x`, JSON.stringify(lead));
  }
  assert.equal(guardFormula("Coffee"), "Coffee");
  assert.equal(guardFormula(""), "");
  // Only the first character matters.
  assert.equal(guardFormula("a=b"), "a=b");
});

test("formula injection: the guard reverses by stripping one apostrophe", () => {
  for (const original of ["=SUM(A1)", "'quoted", "''double", "-5 refund", "plain"]) {
    const guarded = guardFormula(original);
    const restored = guarded.startsWith("'") ? guarded.slice(1) : guarded;
    assert.equal(restored, original);
  }
});

test("formula injection is guarded in every text column a person writes", () => {
  const payload = '=HYPERLINK("http://x","y")';
  const [, row] = lines(
    buildTransactionsCsv([
      {
        ...base,
        account_name: payload,
        category_name: payload,
        description: payload,
        notes: payload,
        merchant: payload,
        payment_method: payload,
      },
    ]),
  );
  const guarded = `"'=HYPERLINK(""http://x"",""y"")"`;
  assert.equal(row.split(guarded).length - 1, 6);
});

test("quoting: commas, quotes and newlines survive", () => {
  assert.equal(quoteField("a,b"), '"a,b"');
  assert.equal(quoteField('say "hi"'), '"say ""hi"""');
  assert.equal(quoteField("two\nlines"), '"two\nlines"');
  assert.equal(quoteField("plain"), "plain");
});

test("accented text is written as-is (the BOM tells Excel it's UTF-8)", () => {
  const [, row] = lines(buildTransactionsCsv([{ ...base, description: "Café Zoë" }]));
  assert.equal(row.split(",")[7], "Café Zoë");
});

test("the file name carries the user's day", () => {
  assert.equal(exportFileName("2026-11-14"), "sorrel-transactions-2026-11-14.csv");
});
