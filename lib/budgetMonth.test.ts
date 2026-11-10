import { test } from "node:test";
import assert from "node:assert/strict";
import { carriedFromLabel, formatMonthName } from "./budgetMonth";

test("carried from names the month the amount came from", () => {
  assert.equal(carriedFromLabel("2026-10-01", "2026-11-01"), "carried from October");
});

// Not strictly last month: a skipped month doesn't reset anyone, so the
// label may name a month further back.
test("a skipped month names the older month it really came from", () => {
  assert.equal(carriedFromLabel("2026-08-01", "2026-11-01"), "carried from August");
});

test("across a new year, the year is said", () => {
  assert.equal(carriedFromLabel("2025-12-01", "2026-01-01"), "carried from December 2025");
});

test("never off by one west of UTC", () => {
  assert.equal(formatMonthName("2026-11-01"), "November");
});
