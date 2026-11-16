import { test } from "node:test";
import assert from "node:assert/strict";
import { importedThroughDate, importedThroughLabel, importedThroughSentence } from "./importedThrough";

test("current year drops the year, another year keeps it", () => {
  assert.equal(importedThroughDate("2026-11-08", "2026-11-16"), "Nov 8");
  assert.equal(importedThroughDate("2025-12-30", "2026-01-02"), "Dec 30, 2025");
});

test("an account never imported into shows nothing", () => {
  assert.equal(importedThroughLabel(null, "2026-11-16"), null);
  assert.equal(importedThroughSentence("Checking", null, "2026-11-16"), null);
});

test("states the fact, with no nudge", () => {
  assert.equal(importedThroughLabel("2026-11-14", "2026-11-16"), "Imported through Nov 14");
  const s = importedThroughSentence("Checking", "2026-11-08", "2026-11-16")!;
  assert.equal(s, "Your last import for Checking ran through Nov 8. Downloading from a few days before that is fine.");
  assert.doesNotMatch(s, /overdue|behind|haven't|!|remind/i);
});
