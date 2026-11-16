import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WHATS_NEW_DAYS,
  WHATS_NEW_EDITION,
  WHATS_NEW_FROM,
  WHATS_NEW_LAST_DAY,
  WHATS_NEW_LINES,
  WHATS_NEW_PRIVACY_LINE,
  whatsNewVisible,
} from "./whatsNew";

test("shows for 30 days from the deploy date, then never again", () => {
  assert.equal(whatsNewVisible(WHATS_NEW_FROM, undefined), true);
  assert.equal(WHATS_NEW_LAST_DAY, "2026-12-16");
  assert.equal(whatsNewVisible(WHATS_NEW_LAST_DAY, undefined), true);
  assert.equal(whatsNewVisible("2026-12-17", undefined), false);
  assert.equal(WHATS_NEW_DAYS, 30);
});

test("not before the deploy date", () => {
  assert.equal(whatsNewVisible("2026-11-16", undefined), false);
});

test("Got it hides it for this edition only", () => {
  assert.equal(whatsNewVisible("2026-11-20", WHATS_NEW_EDITION), false);
  assert.equal(whatsNewVisible("2026-11-20", "2026-01"), true);
});

test("seven lines at most, no exclamation marks, the privacy line as written", () => {
  assert.ok(WHATS_NEW_LINES.length <= 7);
  for (const line of [...WHATS_NEW_LINES, WHATS_NEW_PRIVACY_LINE]) {
    assert.doesNotMatch(line, /!/, line);
  }
  assert.equal(WHATS_NEW_PRIVACY_LINE, "Our privacy policy was updated on November 14 to cover imports.");
});
