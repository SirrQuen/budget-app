import { test } from "node:test";
import assert from "node:assert/strict";
import { sinceLabel } from "@/lib/sinceLabel";

// 9pm EDT on Tue Oct 6 is 01:00 UTC on Wed Oct 7.
const NINE_PM_NEW_YORK_OCT_6 = "2026-10-07T01:00:00Z";

test("sinceLabel counts days in the user's zone, not UTC's", () => {
  assert.equal(sinceLabel(NINE_PM_NEW_YORK_OCT_6, "2026-10-07", "America/New_York"), "yesterday");
  assert.equal(sinceLabel(NINE_PM_NEW_YORK_OCT_6, "2026-10-07", "UTC"), "earlier today");
});

test("sinceLabel names the weekday within a week, then the date", () => {
  const tz = "America/New_York";
  assert.equal(sinceLabel("2026-10-07T14:00:00Z", "2026-10-07", tz), "earlier today");
  assert.equal(sinceLabel("2026-10-03T14:00:00Z", "2026-10-07", tz), "Saturday");
  assert.equal(sinceLabel("2026-09-30T14:00:00Z", "2026-10-07", tz), "Sep 30");
});

test("sinceLabel falls back on an unparseable timestamp", () => {
  assert.equal(sinceLabel("not a date", "2026-10-07", null), "your last visit");
});
