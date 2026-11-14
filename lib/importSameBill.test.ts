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
