import { test } from "node:test";
import assert from "node:assert/strict";
import { centsToAmountText, whatIfPrefill } from "./openAddForm";

test("centsToAmountText: integer cents to the form's text, never through a float", () => {
  assert.equal(centsToAmountText(90000), "900.00");
  assert.equal(centsToAmountText(90050), "900.50");
  assert.equal(centsToAmountText(29), "0.29");
  assert.equal(centsToAmountText(5), "0.05");
  assert.equal(centsToAmountText(999_999_999_999), "9999999999.99");
});

test("whatIfPrefill: an expense, the amount and the day asked about -- nothing else", () => {
  assert.deepEqual(whatIfPrefill(90000, "2026-11-21"), {
    transaction_type: "Expense",
    amount: "900.00",
    transaction_date: "2026-11-21",
  });
});
