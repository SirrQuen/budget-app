import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeToSpendCommitment, isSpendableAccountType } from "./safeToSpend";

test("isSpendableAccountType: only Checking and Savings", () => {
  assert.equal(isSpendableAccountType("Checking"), true);
  assert.equal(isSpendableAccountType("Savings"), true);
  assert.equal(isSpendableAccountType("Cash"), false);
  assert.equal(isSpendableAccountType("Investment"), false);
  assert.equal(isSpendableAccountType("Credit Card"), false);
  assert.equal(isSpendableAccountType("Loan"), false);
});

// The seven rows of the safe-to-spend commitment table.

test("row 1: Expense from Checking -- subtract", () => {
  assert.equal(
    isSafeToSpendCommitment({ transactionType: "Expense", fromAccountType: "Checking", toAccountType: null }),
    true,
  );
});

test("row 2: Expense from Savings -- subtract", () => {
  assert.equal(
    isSafeToSpendCommitment({ transactionType: "Expense", fromAccountType: "Savings", toAccountType: null }),
    true,
  );
});

test("row 3: Transfer Checking -> Investment (leaves the spendable set) -- subtract", () => {
  assert.equal(
    isSafeToSpendCommitment({
      transactionType: "Transfer",
      fromAccountType: "Checking",
      toAccountType: "Investment",
    }),
    true,
  );
});

// The regression-prone row: both legs are spendable, so the money never
// actually leaves the Checking/Savings set.
test("row 4: Transfer Checking -> Savings (stays spendable) -- do not subtract", () => {
  assert.equal(
    isSafeToSpendCommitment({
      transactionType: "Transfer",
      fromAccountType: "Checking",
      toAccountType: "Savings",
    }),
    false,
  );
});

test("row 5: Transfer Credit Card -> Checking (source not spendable) -- do not subtract", () => {
  assert.equal(
    isSafeToSpendCommitment({
      transactionType: "Transfer",
      fromAccountType: "Credit Card",
      toAccountType: "Checking",
    }),
    false,
  );
});

test("row 6: Expense charged to a Credit Card -- do not subtract", () => {
  assert.equal(
    isSafeToSpendCommitment({
      transactionType: "Expense",
      fromAccountType: "Credit Card",
      toAccountType: null,
    }),
    false,
  );
});

test("row 7: Expense from Cash -- do not subtract", () => {
  assert.equal(
    isSafeToSpendCommitment({ transactionType: "Expense", fromAccountType: "Cash", toAccountType: null }),
    false,
  );
});

// Extra coverage beyond the seven required rows: Investment as a source is
// the other "not spendable" account type besides Cash/Credit Card/Loan.
test("Transfer from Investment -- do not subtract, regardless of destination", () => {
  assert.equal(
    isSafeToSpendCommitment({
      transactionType: "Transfer",
      fromAccountType: "Investment",
      toAccountType: "Checking",
    }),
    false,
  );
});

test("Transfer Savings -> Checking (both spendable, reverse direction) -- do not subtract", () => {
  assert.equal(
    isSafeToSpendCommitment({
      transactionType: "Transfer",
      fromAccountType: "Savings",
      toAccountType: "Checking",
    }),
    false,
  );
});
