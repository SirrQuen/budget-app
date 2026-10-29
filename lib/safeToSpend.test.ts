import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeToSpendCommitment, isSafeToSpendIncome, isSpendableAccountType } from "./safeToSpend";

test("isSpendableAccountType: only Checking and Cash", () => {
  assert.equal(isSpendableAccountType("Checking"), true);
  assert.equal(isSpendableAccountType("Cash"), true);
  assert.equal(isSpendableAccountType("Savings"), false);
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

test("row 2: Expense from Cash -- subtract", () => {
  assert.equal(
    isSafeToSpendCommitment({ transactionType: "Expense", fromAccountType: "Cash", toAccountType: null }),
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
// actually leaves the Checking/Cash set. An ATM withdrawal isn't spending.
test("row 4: Transfer Checking -> Cash (stays spendable) -- do not subtract", () => {
  assert.equal(
    isSafeToSpendCommitment({
      transactionType: "Transfer",
      fromAccountType: "Checking",
      toAccountType: "Cash",
    }),
    false,
  );
});

// Savings is still the user's money, but not spendable: moving money into
// it leaves the set.
test("Transfer Checking or Cash -> Savings (leaves the spendable set) -- subtract", () => {
  for (const from of ["Checking", "Cash"]) {
    assert.equal(
      isSafeToSpendCommitment({ transactionType: "Transfer", fromAccountType: from, toAccountType: "Savings" }),
      true,
      from,
    );
  }
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

test("row 7: Expense from Savings -- do not subtract", () => {
  assert.equal(
    isSafeToSpendCommitment({ transactionType: "Expense", fromAccountType: "Savings", toAccountType: null }),
    false,
  );
});

// Extra coverage beyond the seven required rows: Investment as a source is
// the other "not spendable" account type besides Savings/Credit Card/Loan.
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

test("Transfer Cash -> Checking (both spendable, reverse direction) -- do not subtract", () => {
  assert.equal(
    isSafeToSpendCommitment({
      transactionType: "Transfer",
      fromAccountType: "Cash",
      toAccountType: "Checking",
    }),
    false,
  );
});

test("Transfer Savings -> Checking (source not spendable) -- do not subtract", () => {
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

test("income: Income into Checking or Cash counts; into anything else does not", () => {
  assert.equal(isSafeToSpendIncome({ transactionType: "Income", fromAccountType: "Checking", toAccountType: null }), true);
  assert.equal(isSafeToSpendIncome({ transactionType: "Income", fromAccountType: "Cash", toAccountType: null }), true);
  assert.equal(isSafeToSpendIncome({ transactionType: "Income", fromAccountType: "Investment", toAccountType: null }), false);
  assert.equal(isSafeToSpendIncome({ transactionType: "Income", fromAccountType: "Savings", toAccountType: null }), false);
});

test("income: a Transfer counts only when it crosses into the set", () => {
  const transfer = (from: string, to: string) =>
    isSafeToSpendIncome({ transactionType: "Transfer", fromAccountType: from, toAccountType: to });
  assert.equal(transfer("Investment", "Checking"), true);
  assert.equal(transfer("Savings", "Checking"), true);
  assert.equal(transfer("Savings", "Cash"), true);
  assert.equal(transfer("Loan", "Cash"), true);
  assert.equal(transfer("Checking", "Cash"), false);
  assert.equal(transfer("Cash", "Checking"), false);
  assert.equal(transfer("Checking", "Savings"), false);
  assert.equal(transfer("Checking", "Credit Card"), false);
  assert.equal(transfer("Investment", "Savings"), false);
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
