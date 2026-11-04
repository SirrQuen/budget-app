import { test } from "node:test";
import assert from "node:assert/strict";
import { amountChanged, defaultEditScope, parseEditScope } from "./recurringEditScope";

test("a fixed schedule defaults to this and future; a variable one to just this one", () => {
  assert.equal(defaultEditScope(false), "future");
  assert.equal(defaultEditScope(true), "one");
});

test("only an explicit 'future' propagates", () => {
  assert.equal(parseEditScope("future"), "future");
  assert.equal(parseEditScope("one"), "one");
  assert.equal(parseEditScope(null), "one");
  assert.equal(parseEditScope("FUTURE"), "one");
});

test("an amount change is judged in cents", () => {
  assert.equal(amountChanged(142, 412), true);
  assert.equal(amountChanged(142, 142.0), false);
  assert.equal(amountChanged(0.1 + 0.2, 0.3), false);
});
