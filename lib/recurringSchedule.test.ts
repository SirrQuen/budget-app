import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confirmationOpensOn,
  paydayWindowEnd,
  expenseCommitmentDate,
} from "./recurringSchedule";

test("confirmationOpensOn rounds EARLY (anchor minus tolerance)", () => {
  assert.equal(confirmationOpensOn("2026-10-01", 3), "2026-09-28");
  assert.equal(confirmationOpensOn("2026-10-01", 0), "2026-10-01");
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
    const opensAt = confirmationOpensOn(anchor, tolerance);
    const windowEnd = paydayWindowEnd(anchor, tolerance);
    assert.ok(windowEnd >= opensAt, `windowEnd ${windowEnd} should be >= opensAt ${opensAt}`);
    if (tolerance > 0) {
      assert.ok(windowEnd > opensAt, `windowEnd ${windowEnd} should be > opensAt ${opensAt}`);
    } else {
      assert.equal(windowEnd, opensAt);
    }
  }
});

test("expenseCommitmentDate rounds EARLY (anchor minus tolerance), same formula as confirmationOpensOn", () => {
  assert.equal(expenseCommitmentDate("2026-10-01", 3), "2026-09-28");
  assert.equal(expenseCommitmentDate("2026-10-01", 0), "2026-10-01");
});

// The pin the task asked for: identical anchor and tolerance must produce
// DIFFERENT window boundaries for Income vs Expense -- Income widens late
// (a paycheck can't arrive later than expected, so the window keeps it in
// view), Expense widens early (a bill can't arrive later, only sooner, so
// safe-to-spend has to start counting it sooner). If these two ever agree,
// one of them has been "fixed" into the other's meaning.
test("an income schedule and an expense schedule with identical anchors/tolerances produce different window boundaries", () => {
  const anchor = "2026-10-01";
  for (const tolerance of [1, 3, 14]) {
    const incomeBoundary = paydayWindowEnd(anchor, tolerance);
    const expenseBoundary = expenseCommitmentDate(anchor, tolerance);
    assert.notEqual(incomeBoundary, expenseBoundary);
    assert.ok(incomeBoundary > anchor, `income boundary ${incomeBoundary} should be after the anchor`);
    assert.ok(expenseBoundary < anchor, `expense boundary ${expenseBoundary} should be before the anchor`);
  }
  // Tolerance 0 has no real asymmetry to pin -- both reduce to the anchor.
  assert.equal(paydayWindowEnd(anchor, 0), expenseCommitmentDate(anchor, 0));
});
