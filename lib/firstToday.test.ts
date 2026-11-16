import { test } from "node:test";
import assert from "node:assert/strict";
import { isFirstSaveOfDay } from "./firstToday";

test("nothing else ever created: the first of its day", () => {
  assert.equal(isFirstSaveOfDay(null, "2026-11-16", "America/New_York"), true);
});

test("another row created earlier today: not the first", () => {
  assert.equal(isFirstSaveOfDay("2026-11-16T14:00:00Z", "2026-11-16", "America/New_York"), false);
});

test("the newest other row was created yesterday: the first", () => {
  assert.equal(isFirstSaveOfDay("2026-11-15T14:00:00Z", "2026-11-16", "America/New_York"), true);
});

test("the user's day, not UTC's: 9pm New York on the 15th is still the 15th", () => {
  // 2026-11-16T02:00:00Z is 9pm on the 15th in New York.
  assert.equal(isFirstSaveOfDay("2026-11-16T02:00:00Z", "2026-11-16", "America/New_York"), true);
  assert.equal(isFirstSaveOfDay("2026-11-16T02:00:00Z", "2026-11-15", "America/New_York"), false);
});

test("an unset zone reads as UTC", () => {
  assert.equal(isFirstSaveOfDay("2026-11-16T02:00:00Z", "2026-11-16", null), false);
});

test("an unreadable timestamp never claims a first", () => {
  assert.equal(isFirstSaveOfDay("not a date", "2026-11-16", null), false);
});
