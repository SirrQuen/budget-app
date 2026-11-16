import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WHATS_NEW_COOKIE,
  WHATS_NEW_DAYS,
  WHATS_NEW_FROM,
  WHATS_NEW_LAST_DAY,
  WHATS_NEW_LINES,
  WHATS_NEW_PRIVACY_LINE,
  whatsNewVisible,
} from "./whatsNew";

test("shows for 30 days from the deploy date, then never again", () => {
  assert.equal(whatsNewVisible(WHATS_NEW_FROM, false), true);
  assert.equal(WHATS_NEW_FROM, "2026-11-16");
  assert.equal(WHATS_NEW_LAST_DAY, "2026-12-15");
  assert.equal(whatsNewVisible(WHATS_NEW_LAST_DAY, false), true);
  assert.equal(whatsNewVisible("2026-12-16", false), false);
  assert.equal(WHATS_NEW_DAYS, 30);
});

test("not before the deploy date", () => {
  assert.equal(whatsNewVisible("2026-11-15", false), false);
});

test("Got it hides this card", () => {
  assert.equal(whatsNewVisible("2026-11-20", true), false);
  assert.equal(whatsNewVisible("2026-11-20", false), true);
});

test("the cookie is named for the start date, so a later card starts unseen", () => {
  assert.equal(WHATS_NEW_COOKIE, "sorrel_whats_new_seen_2026-11-16");
  assert.equal(WHATS_NEW_COOKIE, `sorrel_whats_new_seen_${WHATS_NEW_FROM}`);
  assert.notEqual(WHATS_NEW_COOKIE, "sorrel_whats_new_seen_2027-01-05");
});

test("seven lines at most, no exclamation marks, the privacy line as written", () => {
  assert.ok(WHATS_NEW_LINES.length <= 7);
  for (const line of [...WHATS_NEW_LINES, WHATS_NEW_PRIVACY_LINE]) {
    assert.doesNotMatch(line, /!/, line);
  }
  assert.equal(WHATS_NEW_PRIVACY_LINE, "Our privacy policy was updated on November 14 to cover imports.");
});
