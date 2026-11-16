import { test } from "node:test";
import assert from "node:assert/strict";
import { logAgainPrefill, recentCombinations, recentPrefill, type LogAgainOptions, type RecentRow } from "./logAgain";

const options: LogAgainOptions = {
  accountIds: new Set(["chk", "sav"]),
  incomeCategoryIds: new Set(["pay"]),
  expenseCategoryIds: new Set(["food", "gas"]),
};

test("an expense carries account, type, category, description and amount -- and no date", () => {
  const p = logAgainPrefill(
    { kind: "single", description: "Shell", amount: 41.5, transaction_type: "Expense", categoryid: "gas", accountid: "chk" },
    options,
  );
  assert.deepEqual(p, {
    transaction_type: "Expense",
    description: "Shell",
    amount: "41.50",
    categoryid: "gas",
    accountid: "chk",
    selectAmount: true,
  });
  assert.equal("transaction_date" in p, false);
  assert.equal("merchant" in p, false);
});

test("an income keeps its type and an income category", () => {
  const p = logAgainPrefill(
    { kind: "single", description: "Paycheck", amount: 1200, transaction_type: "Income", categoryid: "pay", accountid: "chk" },
    options,
  );
  assert.equal(p.transaction_type, "Income");
  assert.equal(p.categoryid, "pay");
  assert.equal(p.amount, "1200.00");
});

test("a transfer carries from, to, amount and description, and no category", () => {
  const p = logAgainPrefill(
    { kind: "transfer", description: "Weekly saving", amount: 50, fromAccountId: "chk", toAccountId: "sav" },
    options,
  );
  assert.deepEqual(p, {
    transaction_type: "Transfer",
    description: "Weekly saving",
    amount: "50.00",
    fromAccountId: "chk",
    toAccountId: "sav",
    selectAmount: true,
  });
});

test("an archived account or category is left empty so the form asks, never silently kept", () => {
  const p = logAgainPrefill(
    { kind: "single", description: "Old", amount: 5, transaction_type: "Expense", categoryid: "gone", accountid: "gone" },
    options,
  );
  assert.equal(p.categoryid, undefined);
  assert.equal(p.accountid, undefined);
  // An expense category is not valid for an income.
  const income = logAgainPrefill(
    { kind: "single", description: "Odd", amount: 5, transaction_type: "Income", categoryid: "food", accountid: "chk" },
    options,
  );
  assert.equal(income.categoryid, undefined);
});

const row = (description: string, accountid = "chk", categoryid = "food", amount = 10): RecentRow => ({
  description,
  amount,
  transaction_type: "Expense",
  categoryid,
  accountid,
});

test("recent: distinct by description, account and category; newest row wins", () => {
  const result = recentCombinations(
    [row("Coffee", "chk", "food", 4), row(" coffee ", "chk", "food", 3), row("Coffee", "sav", "food", 3), row("Coffee", "chk", "gas", 3)],
    options,
  );
  assert.equal(result.length, 3);
  assert.equal(result[0].amount, 4);
});

test("recent: at most five, order kept", () => {
  const rows = ["a", "b", "c", "d", "e", "f", "g"].map((d) => row(d));
  assert.deepEqual(recentCombinations(rows, options).map((r) => r.description), ["a", "b", "c", "d", "e"]);
});

test("recent: archived combinations are skipped before the limit, empty stays empty", () => {
  const rows = [row("x", "gone"), row("y", "chk", "gone"), ...["a", "b", "c", "d", "e"].map((d) => row(d))];
  assert.deepEqual(recentCombinations(rows, options).map((r) => r.description), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(recentCombinations([], options), []);
});

test("a tapped chip fills the form like Log again", () => {
  const r = row("Shell", "chk", "gas", 41.5);
  assert.deepEqual(recentPrefill(r, options), logAgainPrefill({ kind: "single", ...r }, options));
});

test("the goal link comes along, visible and removable -- only while the goal can still be chosen", () => {
  const withGoals: LogAgainOptions = { ...options, goalIds: new Set(["japan"]) };
  const expense = logAgainPrefill(
    { kind: "single", description: "Deposit", amount: 200, transaction_type: "Expense", categoryid: "food", accountid: "chk", goalid: "japan" },
    withGoals,
  );
  assert.equal(expense.goalid, "japan");
  const transfer = logAgainPrefill(
    { kind: "transfer", description: "To savings", amount: 200, fromAccountId: "chk", toAccountId: "sav", goalid: "japan" },
    withGoals,
  );
  assert.equal(transfer.goalid, "japan");
  // Archived or completed since: not offered, so not copied.
  const gone = logAgainPrefill(
    { kind: "transfer", description: "To savings", amount: 200, fromAccountId: "chk", toAccountId: "sav", goalid: "done" },
    withGoals,
  );
  assert.equal("goalid" in gone, false);
  // No goal list at all (the Recent strip): never copied.
  const noList = logAgainPrefill(
    { kind: "transfer", description: "To savings", amount: 200, fromAccountId: "chk", toAccountId: "sav", goalid: "japan" },
    options,
  );
  assert.equal("goalid" in noList, false);
});
