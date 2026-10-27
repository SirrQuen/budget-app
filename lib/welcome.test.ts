import { test } from "node:test";
import assert from "node:assert/strict";
import { WELCOMED_ON_MAX_AGE_S, parseWelcomeReason, welcomeDay } from "./welcome";

test("only a known reason is a welcome", () => {
  assert.equal(parseWelcomeReason("confirmed"), "confirmed");
  assert.equal(parseWelcomeReason(undefined), null);
  assert.equal(parseWelcomeReason("anything-else"), null);
});

test("the welcomed-on cookie lives a week, not the browser's 400-day ceiling", () => {
  assert.equal(WELCOMED_ON_MAX_AGE_S, 7 * 24 * 60 * 60);
});

test("welcomeDay is the user's calendar day, never UTC's", () => {
  // 8:30pm EDT on Oct 27 is already Oct 28 in UTC.
  const evening = new Date("2026-10-28T00:30:00Z");
  assert.equal(welcomeDay("America/New_York", null, evening), "2026-10-27");
});

test("11:55pm and 12:05am local are two days", () => {
  assert.equal(welcomeDay("America/New_York", null, new Date("2026-10-28T03:55:00Z")), "2026-10-27");
  assert.equal(welcomeDay("America/New_York", null, new Date("2026-10-28T04:05:00Z")), "2026-10-28");
});

test("no stored zone yet (a brand-new user): the browser's zone from the form", () => {
  const evening = new Date("2026-10-28T00:30:00Z");
  assert.equal(welcomeDay(null, "America/New_York", evening), "2026-10-27");
});

test("the stored zone wins over the form's", () => {
  const evening = new Date("2026-10-28T00:30:00Z");
  assert.equal(welcomeDay("America/New_York", "Asia/Tokyo", evening), "2026-10-27");
});

test("a junk form zone is ignored: UTC, the documented fallback", () => {
  const evening = new Date("2026-10-28T00:30:00Z");
  assert.equal(welcomeDay(null, "Not/AZone", evening), "2026-10-28");
  assert.equal(welcomeDay(null, null, evening), "2026-10-28");
});
