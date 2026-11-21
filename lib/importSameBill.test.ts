import { test } from "node:test";
import assert from "node:assert/strict";
import { findImportSameBill, type ImportSameBillItem } from "./sameBill";

// "Is this the same bill?" at import time (docs/Import-CSV.md, step 12):
// a past-dated row against an occurrence waiting in the confirmation queue.

const RENT: ImportSameBillItem = {
  recurringId: "rent",
  name: "Rent",
  kind: "Expense",
  accountId: "chk",
  toAccountId: null,
  amount: 1850,
  dueDate: "2026-11-01",
  dateToleranceDays: 0,
};

const ROW = { row: 5, type: "Expense" as const, date: "2026-11-01", cents: 185000 };

test("a past row for the queue's occurrence is matched", () => {
  assert.deepEqual(findImportSameBill([ROW], [RENT], "chk"), [
    { row: 5, recurringId: "rent", name: "Rent", dueDate: "2026-11-01", cents: 185000 },
  ]);
});

test("same account, direction and exact amount", () => {
  assert.equal(findImportSameBill([{ ...ROW, cents: 185001 }], [RENT], "chk").length, 0);
  assert.equal(findImportSameBill([{ ...ROW, type: "Income" }], [RENT], "chk").length, 0);
  assert.equal(findImportSameBill([ROW], [RENT], "other").length, 0);
});

test("the window is the schedule's tolerance or 3 days, whichever is wider -- wider than the queue's", () => {
  // A fixed bill (tolerance 0): the bank posts it a day or two late.
  for (const date of ["2026-10-29", "2026-11-01", "2026-11-02", "2026-11-04"]) {
    assert.equal(findImportSameBill([{ ...ROW, date }], [RENT], "chk").length, 1, date);
  }
  for (const date of ["2026-10-28", "2026-11-05"]) {
    assert.equal(findImportSameBill([{ ...ROW, date }], [RENT], "chk").length, 0, date);
  }
  // A wide tolerance still wins.
  const loose = { ...RENT, dateToleranceDays: 6 };
  assert.equal(findImportSameBill([{ ...ROW, date: "2026-11-07" }], [loose], "chk").length, 1);
  assert.equal(findImportSameBill([{ ...ROW, date: "2026-11-08" }], [loose], "chk").length, 0);
});

test("a transfer schedule is never a match", () => {
  const transfer: ImportSameBillItem = { ...RENT, kind: "Transfer", toAccountId: "sav" };
  assert.equal(findImportSameBill([ROW], [transfer], "chk").length, 0);
});

test("one row per schedule and one schedule per row, the closest first", () => {
  const m = findImportSameBill([{ ...ROW, row: 7, date: "2026-11-03" }, ROW], [RENT], "chk");
  assert.deepEqual(m.map((x) => x.row), [5]);

  const two: ImportSameBillItem[] = [
    { ...RENT, recurringId: "a", name: "A" },
    { ...RENT, recurringId: "b", name: "B" },
  ];
  const both = findImportSameBill([ROW, { ...ROW, row: 6 }], two, "chk");
  assert.deepEqual(both.map((x) => [x.row, x.recurringId]), [[5, "a"], [6, "b"]]);
});

// Migration 76: a transfer row that creates both legs is asked about a
// transfer schedule whose two ends are this account and the row's other
// account, in the row's direction.
const CARD_PAY: ImportSameBillItem = {
  recurringId: "visa-pay",
  name: "Visa payment",
  kind: "Transfer",
  accountId: "chk",
  toAccountId: "visa",
  amount: 500,
  dueDate: "2026-11-03",
  dateToleranceDays: 0,
};

test("a transfer row matches a transfer schedule on both ends, in its direction", () => {
  const out = { row: 7, type: "Expense" as const, date: "2026-11-03", cents: 50000, transferOtherAccountId: "visa" };
  assert.equal(findImportSameBill([out], [CARD_PAY], "chk").length, 1);
  // The wrong other end, or the wrong way round, or not a transfer at all.
  assert.equal(findImportSameBill([{ ...out, transferOtherAccountId: "sav" }], [CARD_PAY], "chk").length, 0);
  assert.equal(findImportSameBill([{ ...out, type: "Income" }], [CARD_PAY], "chk").length, 0);
  assert.equal(findImportSameBill([{ ...out, transferOtherAccountId: null }], [CARD_PAY], "chk").length, 0);
  // Imported from the card's side: money in, from checking.
  const onVisa = { row: 8, type: "Income" as const, date: "2026-11-03", cents: 50000, transferOtherAccountId: "chk" };
  assert.equal(findImportSameBill([onVisa], [CARD_PAY], "visa").length, 1);
});

test("a transfer row never matches a plain bill", () => {
  const out = { row: 7, type: "Expense" as const, date: "2026-11-01", cents: 185000, transferOtherAccountId: "sav" };
  assert.equal(findImportSameBill([out], [RENT], "chk").length, 0);
});
