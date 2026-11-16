import { test } from "node:test";
import assert from "node:assert/strict";
import { goalDeleteNote, goalFieldAsks, goalLinkable, parseGoalId } from "./goalLinks";

const GOAL = "11111111-2222-4333-8444-555555555555";

test("expenses and transfers can be for a goal; income never", () => {
  assert.equal(goalLinkable("Expense"), true);
  assert.equal(goalLinkable("Transfer"), true);
  assert.equal(goalLinkable("Income"), false);
});

test("the field asks only for a transfer leaving the spendable set", () => {
  assert.equal(goalFieldAsks("Transfer", "Checking", "Savings"), true);
  assert.equal(goalFieldAsks("Transfer", "Cash", "Investment"), true);
  // Checking -> Cash stays spendable; Savings -> Checking comes back in.
  assert.equal(goalFieldAsks("Transfer", "Checking", "Cash"), false);
  assert.equal(goalFieldAsks("Transfer", "Savings", "Checking"), false);
  // A card payment leaves the set too: it's a debt goal's likely money.
  assert.equal(goalFieldAsks("Transfer", "Checking", "Credit Card"), true);
  // Not a transfer, or an account not chosen yet.
  assert.equal(goalFieldAsks("Expense", "Checking", "Savings"), false);
  assert.equal(goalFieldAsks("Transfer", "Checking", undefined), false);
});

test("parseGoalId: a uuid for an expense or transfer, null otherwise", () => {
  assert.equal(parseGoalId(GOAL, "Expense"), GOAL);
  assert.equal(parseGoalId(` ${GOAL} `, "Transfer"), GOAL);
  assert.equal(parseGoalId(GOAL, "Income"), null);
  assert.equal(parseGoalId("", "Expense"), null);
  assert.equal(parseGoalId(null, "Expense"), null);
  assert.equal(parseGoalId("not-a-goal", "Expense"), null);
});

test("the delete confirmation names the goal", () => {
  assert.equal(goalDeleteNote("Japan"), "It also comes off your Japan goal.");
  assert.equal(goalDeleteNote(null), undefined);
});
