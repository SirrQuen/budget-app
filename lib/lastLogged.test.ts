import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarDateLabel, lastLoggedLabel } from "./lastLogged";

test("states the fact as a date", () => {
  assert.equal(lastLoggedLabel("2026-11-09", "2026-11-09"), "Last logged Nov 9");
  assert.equal(lastLoggedLabel("2026-11-12", "2026-11-14"), "Last logged Nov 12");
  assert.equal(lastLoggedLabel("2026-01-01", "2026-11-14"), "Last logged Jan 1");
});

test("the year appears only when it isn't the current year", () => {
  assert.equal(lastLoggedLabel("2025-11-12", "2026-11-14"), "Last logged Nov 12, 2025");
  assert.equal(lastLoggedLabel("2025-12-31", "2026-01-01"), "Last logged Dec 31, 2025");
  assert.equal(lastLoggedLabel("2026-01-01", "2026-01-01"), "Last logged Jan 1");
});

// No threshold: a long gap reads exactly like a short one.
test("no threshold changes the wording", () => {
  assert.equal(lastLoggedLabel("2024-02-29", "2026-11-14"), "Last logged Feb 29, 2024");
});

test("never a scolding, never a nudge", () => {
  for (const d of ["2026-11-09", "2026-11-01", "2026-01-01", "2020-06-15", null]) {
    const label = lastLoggedLabel(d, "2026-11-09");
    assert.doesNotMatch(label, /you haven't|you have not|!|overdue|behind|stale|ago/i, label);
  }
  assert.equal(lastLoggedLabel(null, "2026-11-09"), "Nothing logged yet");
});

test("a day ahead (clock skew) reads as today's date", () => {
  assert.equal(lastLoggedLabel("2026-11-10", "2026-11-09"), "Last logged Nov 9");
  assert.equal(lastLoggedLabel("2027-01-01", "2026-12-31"), "Last logged Dec 31");
});

// "Imported through" shares this formatter: one year rule.
test("calendarDateLabel is the shared date and year rule", () => {
  assert.equal(calendarDateLabel("2026-11-08", "2026-11-16"), "Nov 8");
  assert.equal(calendarDateLabel("2025-12-30", "2026-01-02"), "Dec 30, 2025");
});
