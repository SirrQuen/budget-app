import { test } from "node:test";
import assert from "node:assert/strict";
import {
  incomeConfirmationOpensAt,
  paydayWindowEnd,
  isAwaitingIncomeConfirmation,
} from "./recurringSchedule";

test("incomeConfirmationOpensAt rounds EARLY (anchor minus tolerance)", () => {
  assert.equal(incomeConfirmationOpensAt("2026-10-01", 3), "2026-09-28");
  assert.equal(incomeConfirmationOpensAt("2026-10-01", 0), "2026-10-01");
});

test("paydayWindowEnd rounds LATE (anchor plus tolerance)", () => {
  assert.equal(paydayWindowEnd("2026-10-01", 3), "2026-10-04");
  assert.equal(paydayWindowEnd("2026-10-01", 0), "2026-10-01");
});

// The pin: using the prompt's own (early) date for the payday window would
// shorten it and inflate the safe-to-spend hero (CLAUDE.md "Date handling").
// The two must never coincide once there's any tolerance at all, and must
// never invert.
test("the payday window end is never earlier than the confirmation prompt's open date", () => {
  const anchor = "2026-10-01";
  for (const tolerance of [0, 1, 3, 14]) {
    const opensAt = incomeConfirmationOpensAt(anchor, tolerance);
    const windowEnd = paydayWindowEnd(anchor, tolerance);
    assert.ok(windowEnd >= opensAt, `windowEnd ${windowEnd} should be >= opensAt ${opensAt}`);
    if (tolerance > 0) {
      assert.ok(windowEnd > opensAt, `windowEnd ${windowEnd} should be > opensAt ${opensAt}`);
    } else {
      assert.equal(windowEnd, opensAt);
    }
  }
});

test("isAwaitingIncomeConfirmation opens at anchor - tolerance and stays open indefinitely", () => {
  assert.equal(isAwaitingIncomeConfirmation("2026-09-27", "2026-10-01", 3), false);
  assert.equal(isAwaitingIncomeConfirmation("2026-09-28", "2026-10-01", 3), true);
  assert.equal(isAwaitingIncomeConfirmation("2026-10-01", "2026-10-01", 3), true);
  assert.equal(isAwaitingIncomeConfirmation("2026-12-01", "2026-10-01", 3), true);
});

test("isAwaitingIncomeConfirmation with zero tolerance opens exactly on the anchor", () => {
  assert.equal(isAwaitingIncomeConfirmation("2026-09-30", "2026-10-01", 0), false);
  assert.equal(isAwaitingIncomeConfirmation("2026-10-01", "2026-10-01", 0), true);
});
