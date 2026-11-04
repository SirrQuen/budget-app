import { test } from "node:test";
import assert from "node:assert/strict";
import { firstDateAfterSource, newScheduleStartDate, nextOccurrenceISO, shouldReanchor } from "@/lib/recurringCadence";

// Steps a Monthly schedule the way confirmOccurrence advances it, one
// cycle per answer: the cursor advances, the anchor (start_date) doesn't.
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

// "Make recurring": the source transaction is the first occurrence.
test("firstDateAfterSource: the occurrence after the source, never the source's own date", () => {
  assert.equal(firstDateAfterSource("2026-10-01", "Monthly", 1), "2026-11-01");
  assert.equal(firstDateAfterSource("2026-10-28", "Weekly", 2), "2026-11-11");
  assert.equal(firstDateAfterSource("2026-01-31", "Monthly", 1), "2026-02-28");
  assert.equal(firstDateAfterSource("2026-03-15", "Yearly", 1), "2027-03-15");
});

test("newScheduleStartDate: anchored on the source when the schedule continues from it", () => {
  // Jan 31 -> Feb 28: anchored on the 31st, so March is the 31st again.
  const next = { next_run_date: "2026-02-28", frequency: "Monthly", interval_count: 1 };
  assert.equal(newScheduleStartDate(next, "2026-01-31"), "2026-01-31");
  assert.equal(nextOccurrenceISO("2026-02-28", "Monthly", 1, newScheduleStartDate(next, "2026-01-31")), "2026-03-31");
});

test("newScheduleStartDate: a moved date, or no source, anchors on the first date", () => {
  assert.equal(
    newScheduleStartDate({ next_run_date: "2026-11-05", frequency: "Monthly", interval_count: 1 }, "2026-10-01"),
    "2026-11-05",
  );
  assert.equal(
    newScheduleStartDate({ next_run_date: "2026-11-01", frequency: "Monthly", interval_count: 1 }, null),
    "2026-11-01",
  );
});
