import { test } from "node:test";
import assert from "node:assert/strict";
import { showsQuickAdd } from "./visibility";

test("shown on exactly the dashboard, transactions and accounts, and their sub-pages", () => {
  for (const p of ["/dashboard", "/transactions", "/transactions/abc/edit", "/accounts", "/accounts/x"]) {
    assert.equal(showsQuickAdd(p), true, p);
  }
});

test("not on the screens about something else", () => {
  for (const p of ["/budgets", "/categories", "/settings", "/recurring", "/recurring/abc", "/goals", "/goals/new"]) {
    assert.equal(showsQuickAdd(p), false, p);
  }
});

// The point of the allowlist: a screen nobody has decided about doesn't get it.
test("a new route doesn't get it by default, nor does a lookalike prefix", () => {
  for (const p of ["/reports", "/insights/monthly", "/", "/dashboardx", "/transactions-old", "/accountsettings"]) {
    assert.equal(showsQuickAdd(p), false, p);
  }
});
