import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBudgetAmount } from "./budgetAmount";

test("$0 is a budget", () => {
  assert.deepEqual(parseBudgetAmount("0"), { value: 0 });
  assert.deepEqual(parseBudgetAmount("0.00"), { value: 0 });
});

test("ordinary amounts parse to dollars", () => {
  assert.deepEqual(parseBudgetAmount("600"), { value: 600 });
  assert.deepEqual(parseBudgetAmount(" 82.5 "), { value: 82.5 });
});

test("blank, negative, or past cents is refused", () => {
  for (const raw of ["", "  ", "-5", "1.234", "abc", null]) {
    assert.ok("error" in parseBudgetAmount(raw), String(raw));
  }
});
