import { test } from "node:test";
import assert from "node:assert/strict";
import { lastLoggedLabel } from "./lastLogged";

test("states the fact in days", () => {
  assert.equal(lastLoggedLabel("2026-11-09", "2026-11-09"), "Last logged today");
  assert.equal(lastLoggedLabel("2026-11-08", "2026-11-09"), "Last logged yesterday");
  assert.equal(lastLoggedLabel("2026-10-28", "2026-11-09"), "Last logged 12 days ago");
});

// No threshold: a long gap reads exactly like a short one.
test("no threshold changes the wording", () => {
  assert.equal(lastLoggedLabel("2025-11-09", "2026-11-09"), "Last logged 365 days ago");
});

test("never a scolding, never a nudge", () => {
  for (const d of ["2026-11-09", "2026-11-01", "2026-01-01", null]) {
    const label = lastLoggedLabel(d, "2026-11-09");
    assert.doesNotMatch(label, /you haven't|you have not|!|overdue|behind|stale/i, label);
  }
  assert.equal(lastLoggedLabel(null, "2026-11-09"), "Nothing logged yet");
});

test("a day ahead (clock skew) still reads today", () => {
  assert.equal(lastLoggedLabel("2026-11-10", "2026-11-09"), "Last logged today");
});
