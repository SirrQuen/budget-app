import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeToSpendCommitment, isSafeToSpendIncome, isSpendableAccountType } from "./safeToSpend";

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

// isSafeToSpendIncome -- the mirror rule: cash arriving in the set.

test("income: Income into Checking or Savings counts; into anything else does not", () => {
  assert.equal(isSafeToSpendIncome({ transactionType: "Income", fromAccountType: "Checking", toAccountType: null }), true);
  assert.equal(isSafeToSpendIncome({ transactionType: "Income", fromAccountType: "Savings", toAccountType: null }), true);
  assert.equal(isSafeToSpendIncome({ transactionType: "Income", fromAccountType: "Investment", toAccountType: null }), false);
  assert.equal(isSafeToSpendIncome({ transactionType: "Income", fromAccountType: "Cash", toAccountType: null }), false);
});

test("income: a Transfer counts only when it crosses into the set", () => {
  const transfer = (from: string, to: string) =>
    isSafeToSpendIncome({ transactionType: "Transfer", fromAccountType: from, toAccountType: to });
  assert.equal(transfer("Investment", "Checking"), true);
  assert.equal(transfer("Loan", "Savings"), true);
  assert.equal(transfer("Checking", "Savings"), false);
  assert.equal(transfer("Savings", "Checking"), false);
  assert.equal(transfer("Checking", "Credit Card"), false);
  assert.equal(transfer("Investment", "Cash"), false);
});

test("a Transfer is never both income and a commitment", () => {
  for (const from of ["Checking", "Savings", "Credit Card", "Loan", "Investment", "Cash"]) {
    for (const to of ["Checking", "Savings", "Credit Card", "Loan", "Investment", "Cash"]) {
      const income = isSafeToSpendIncome({ transactionType: "Transfer", fromAccountType: from, toAccountType: to });
      const commitment = isSafeToSpendCommitment({ transactionType: "Transfer", fromAccountType: from, toAccountType: to });
      assert.ok(!(income && commitment), `${from} -> ${to}`);
    }
  }
});
