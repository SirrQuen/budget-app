import { test } from "node:test";
import assert from "node:assert/strict";
import { todayInZone, isValidTimeZone, monthStartISO } from "@/lib/date";

// 11pm EDT on Oct 6 is 03:00 UTC on Oct 7 -- the instant the server's own
// clock used to call "tomorrow".
const ELEVEN_PM_NEW_YORK = new Date("2026-10-07T03:00:00Z");

test("todayInZone names the user's day, not UTC's", () => {
  assert.equal(todayInZone("America/New_York", ELEVEN_PM_NEW_YORK), "2026-10-06");
  assert.equal(todayInZone("UTC", ELEVEN_PM_NEW_YORK), "2026-10-07");
  assert.equal(todayInZone("Asia/Tokyo", ELEVEN_PM_NEW_YORK), "2026-10-07");
});

test("todayInZone is independent of the process's own zone", () => {
  // Same instant, explicit zones on both sides of the date line.
  const instant = new Date("2026-12-31T11:30:00Z");
  assert.equal(todayInZone("Pacific/Kiritimati", instant), "2027-01-01");
  assert.equal(todayInZone("Pacific/Pago_Pago", instant), "2026-12-31");
});

test("todayInZone falls back to UTC for a missing or unknown zone", () => {
  assert.equal(todayInZone(null, ELEVEN_PM_NEW_YORK), "2026-10-07");
  assert.equal(todayInZone("Not/AZone", ELEVEN_PM_NEW_YORK), "2026-10-07");
});

test("todayInZone across a DST change keeps the wall-clock day", () => {
  // 2026-11-01 01:30 EST (after fall-back) is 06:30 UTC.
  assert.equal(todayInZone("America/New_York", new Date("2026-11-01T06:30:00Z")), "2026-11-01");
  // 2026-03-08 23:30 EDT is 03:30 UTC on the 9th.
  assert.equal(todayInZone("America/New_York", new Date("2026-03-09T03:30:00Z")), "2026-03-08");
});

test("isValidTimeZone", () => {
  assert.equal(isValidTimeZone("Europe/London"), true);
  assert.equal(isValidTimeZone("Not/AZone"), false);
  assert.equal(isValidTimeZone(""), false);
});

test("monthStartISO", () => {
  assert.equal(monthStartISO("2026-10-06"), "2026-10-01");
  assert.equal(monthStartISO("2027-02-28"), "2027-02-01");
});
