import { test } from "node:test";
import assert from "node:assert/strict";
import { nextOccurrenceISO, shouldReanchor } from "@/lib/recurringCadence";

// Steps a Monthly schedule the way generateDueOccurrences does: the cursor
// advances, the anchor (start_date) doesn't.
function monthly(start: string, anchor: string, steps: number): string[] {
  const out = [start];
  let cursor = start;
  for (let i = 1; i < steps; i++) {
    cursor = nextOccurrenceISO(cursor, "Monthly", 1, anchor);
    out.push(cursor);
  }
  return out;
}

test("a 31st schedule clamps in February and April, then returns to the 31st", () => {
  assert.deepEqual(monthly("2027-01-31", "2027-01-31", 6), [
    "2027-01-31",
    "2027-02-28",
    "2027-03-31",
    "2027-04-30",
    "2027-05-31",
    "2027-06-30",
  ]);
  assert.deepEqual(monthly("2028-01-31", "2028-01-31", 3), ["2028-01-31", "2028-02-29", "2028-03-31"]);
});

const feb28 = {
  next_run_date: "2027-02-28",
  frequency: "Monthly",
  interval_count: 1,
  start_date: "2026-12-31",
};

test("saving the form unchanged on a clamped date keeps the 31st anchor", () => {
  assert.equal(shouldReanchor(feb28, { ...feb28 }), false);
  // So the next step still lands on the 31st, not the 28th.
  assert.equal(nextOccurrenceISO("2027-02-28", "Monthly", 1, feb28.start_date), "2027-03-31");
});

test("moving the date or changing the cadence re-anchors", () => {
  assert.equal(shouldReanchor(feb28, { ...feb28, next_run_date: "2027-03-05" }), true);
  assert.equal(shouldReanchor(feb28, { ...feb28, frequency: "Weekly" }), true);
  assert.equal(shouldReanchor(feb28, { ...feb28, interval_count: 2 }), true);
});

test("a legacy row with no anchor gets one", () => {
  assert.equal(shouldReanchor({ ...feb28, start_date: null }, { ...feb28 }), true);
});
