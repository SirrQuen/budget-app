import { test } from "node:test";
import assert from "node:assert/strict";
import { importedThroughLabel, importedThroughSentence } from "./importedThrough";

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
