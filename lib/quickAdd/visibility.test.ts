import { test } from "node:test";
import assert from "node:assert/strict";
import { showsQuickAdd } from "./visibility";

test("gone from exactly the recurring and goals screens, and their sub-pages", () => {
  for (const p of ["/recurring", "/recurring/abc", "/goals", "/goals/new"]) {
    assert.equal(showsQuickAdd(p), false, p);
  }
});

test("present everywhere else", () => {
  for (const p of ["/dashboard", "/transactions", "/transactions/abc/edit", "/accounts", "/budgets", "/categories", "/settings", "/goalsx", "/recurring-old"]) {
    assert.equal(showsQuickAdd(p), true, p);
  }
});
