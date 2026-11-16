import { test } from "node:test";
import assert from "node:assert/strict";
import { loggedMessage, savedSummary } from "./savedSummary";
import type { LogAgainSource } from "./logAgain";

const coffee: LogAgainSource = {
  kind: "single",
  description: "Coffee",
  amount: 5.75,
  transaction_type: "Expense",
  categoryid: "c1",
  accountid: "a1",
};

test("the toast line is the same shape for every amount", () => {
  assert.equal(loggedMessage("Coffee", 5.75), "Logged · Coffee $5.75");
  assert.equal(loggedMessage("Laptop", 2400), "Logged · Laptop $2,400.00");
});

test("no description: just the figure", () => {
  assert.equal(loggedMessage("  ", 5.75), "Logged · $5.75");
});

test("first save today comes from the response", () => {
  assert.equal(savedSummary(coffee, { firstToday: true }).firstToday, true);
  assert.equal(savedSummary(coffee, { firstToday: false }).firstToday, false);
  assert.equal(savedSummary(coffee, undefined).firstToday, false);
});

test("the very first transaction keeps its own line and no chip", () => {
  const s = savedSummary(coffee, { milestone: { message: "First transaction logged" }, firstToday: true });
  assert.equal(s.message, "First transaction logged");
  assert.equal(s.firstToday, false);
});

test("it carries what Log again refills", () => {
  assert.equal(savedSummary(coffee, undefined).source, coffee);
});
