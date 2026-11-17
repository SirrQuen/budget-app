import { test } from "node:test";
import assert from "node:assert/strict";
import {
  greetingPhrase,
  greetingWithName,
  hourInZone,
  monthInZone,
  seasonAt,
  seasonForMonth,
  timeBand,
  timeBandAt,
  type TimeBand,
} from "./timeOfDay";

test("every band boundary: 4:59 night, 5:00 morning, 11:59 morning, 12:00 afternoon, 16:59 afternoon, 17:00 evening, 21:59 evening, 22:00 night", () => {
  const cases: [number, TimeBand][] = [
    [4, "night"], // 4:59 is hour 4
    [5, "morning"],
    [11, "morning"], // 11:59
    [12, "afternoon"],
    [16, "afternoon"], // 16:59
    [17, "evening"],
    [21, "evening"], // 21:59
    [22, "night"],
    [0, "night"],
    [23, "night"],
  ];
  for (const [hour, band] of cases) assert.equal(timeBand(hour), band, `hour ${hour}`);
});

// 2026-11-17 in each zone, expressed as the UTC instant of the wall-clock
// time asked for. New York is UTC-5 in November, Tokyo UTC+9.
const NY = "America/New_York";
const TOKYO = "Asia/Tokyo";
const nyAt = (h: number, m: number) => new Date(Date.UTC(2026, 10, 17, h + 5, m));
const tokyoAt = (h: number, m: number) => new Date(Date.UTC(2026, 10, 17, h - 9, m));

const BOUNDARIES: [number, number, TimeBand][] = [
  [4, 59, "night"],
  [5, 0, "morning"],
  [11, 59, "morning"],
  [12, 0, "afternoon"],
  [16, 59, "afternoon"],
  [17, 0, "evening"],
  [21, 59, "evening"],
  [22, 0, "night"],
];

test("band boundaries, read in New York", () => {
  for (const [h, m, band] of BOUNDARIES) assert.equal(timeBandAt(NY, nyAt(h, m)), band, `${h}:${m}`);
});

test("band boundaries, read in Tokyo", () => {
  for (const [h, m, band] of BOUNDARIES) assert.equal(timeBandAt(TOKYO, tokyoAt(h, m)), band, `${h}:${m}`);
});

test("the same instant lands in different bands in different zones", () => {
  const instant = new Date("2026-11-17T14:00:00Z"); // 9am New York, 11pm Tokyo
  assert.equal(timeBandAt(NY, instant), "morning");
  assert.equal(timeBandAt(TOKYO, instant), "night");
});

test("null or unknown zone is UTC", () => {
  const instant = new Date("2026-11-17T13:30:00Z");
  assert.equal(hourInZone(null, instant), 13);
  assert.equal(timeBandAt("Not/AZone", instant), "afternoon");
});

test("every month's season, northern hemisphere", () => {
  const expected = [
    "winter", "winter", // Jan Feb
    "spring", "spring", "spring", // Mar-May
    "summer", "summer", "summer", // Jun-Aug
    "autumn", "autumn", "autumn", // Sep-Nov
    "winter", // Dec
  ];
  expected.forEach((season, i) => assert.equal(seasonForMonth(i + 1), season, `month ${i + 1}`));
});

test("the month is the user's calendar month: a month-end instant differs by zone", () => {
  // 2026-02-28 23:30 in New York is already 2026-03-01 in Tokyo.
  const instant = new Date("2026-03-01T04:30:00Z");
  assert.equal(monthInZone(NY, instant), 2);
  assert.equal(seasonAt(NY, instant), "winter");
  assert.equal(monthInZone(TOKYO, instant), 3);
  assert.equal(seasonAt(TOKYO, instant), "spring");
});

test("season boundaries across zones, both ends", () => {
  // 2026-05-31 20:00 New York = 2026-06-01 09:00 Tokyo.
  const may = new Date("2026-06-01T00:00:00Z");
  assert.equal(seasonAt(NY, may), "spring");
  assert.equal(seasonAt(TOKYO, may), "summer");
  // 2026-11-30 20:00 New York = 2026-12-01 10:00 Tokyo.
  const nov = new Date("2026-12-01T01:00:00Z");
  assert.equal(seasonAt(NY, nov), "autumn");
  assert.equal(seasonAt(TOKYO, nov), "winter");
});

test("greeting: one phrase table, no name at night, never 'there'", () => {
  assert.equal(greetingPhrase("morning"), "Good morning");
  assert.equal(greetingPhrase("night"), "Hi, night owl");
  assert.equal(greetingWithName("evening", "Matt"), "Good evening, Matt");
  assert.equal(greetingWithName("evening", null), "Good evening");
  assert.equal(greetingWithName("night", "Matt"), "Hi, night owl");
});

import { welcomeMessage } from "./displayName";

test("dashboard greeting: first session is Welcome; otherwise the one shared phrase", () => {
  assert.equal(welcomeMessage({ firstName: "Matt" }, true, "morning"), "Welcome, Matt");
  assert.equal(welcomeMessage({}, true, "night"), "Welcome");
  assert.equal(welcomeMessage({ firstName: "Matt" }, false, "afternoon"), "Good afternoon, Matt");
  assert.equal(welcomeMessage({ preferredName: "Mattie", firstName: "Matt" }, false, "evening"), "Good evening, Mattie");
  assert.equal(welcomeMessage({}, false, "morning"), "Good morning");
  assert.equal(welcomeMessage({ firstName: "Matt" }, false, "night"), "Hi, night owl");
});

import { markStateAt, markStateForHour, msUntilNextMarkBoundary } from "./timeOfDay";

test("the flower: 6:59 folded, 7:00 open, 18:59 open, 19:00 folded", () => {
  assert.equal(markStateForHour(6), "folded"); // 6:59
  assert.equal(markStateForHour(7), "open");
  assert.equal(markStateForHour(18), "open"); // 18:59
  assert.equal(markStateForHour(19), "folded");
  assert.equal(markStateForHour(0), "folded");
  assert.equal(markStateForHour(12), "open");
});

test("the flower reads the stored zone's wall clock, in New York and Tokyo", () => {
  const cases: [number, number, "open" | "folded"][] = [
    [6, 59, "folded"],
    [7, 0, "open"],
    [18, 59, "open"],
    [19, 0, "folded"],
  ];
  for (const [h, m, state] of cases) {
    assert.equal(markStateAt(NY, nyAt(h, m)), state, `NY ${h}:${m}`);
    assert.equal(markStateAt(TOKYO, tokyoAt(h, m)), state, `Tokyo ${h}:${m}`);
  }
});

test("the flower and the glow share one hour: the same instant, the same zone, one clock", () => {
  const instant = new Date("2026-11-17T14:00:00Z"); // 9am New York, 11pm Tokyo
  assert.equal(markStateAt(NY, instant), "open");
  assert.equal(timeBandAt(NY, instant), "morning");
  assert.equal(markStateAt(TOKYO, instant), "folded");
  assert.equal(timeBandAt(TOKYO, instant), "night");
  // The browser's own zone is never consulted: an unknown zone is UTC (14:00, open).
  assert.equal(markStateAt("Not/AZone", instant), "open");
  assert.equal(markStateAt(null, instant), "open");
});

test("next flower boundary, in the stored zone", () => {
  const s = 1000;
  const m = 60 * s;
  const h = 60 * m;
  assert.equal(msUntilNextMarkBoundary(NY, nyAt(6, 59)), 1 * m); // to 7:00
  assert.equal(msUntilNextMarkBoundary(NY, nyAt(7, 0)), 12 * h); // on a boundary: the next one
  assert.equal(msUntilNextMarkBoundary(NY, nyAt(18, 59)), 1 * m); // to 19:00
  assert.equal(msUntilNextMarkBoundary(NY, nyAt(19, 0)), 12 * h); // to 7:00 tomorrow
  assert.equal(msUntilNextMarkBoundary(NY, nyAt(23, 0)), 8 * h);
  assert.equal(msUntilNextMarkBoundary(TOKYO, tokyoAt(6, 59)), 1 * m);
  assert.equal(msUntilNextMarkBoundary(TOKYO, tokyoAt(19, 0)), 12 * h);
  // Sub-second remainder is taken off, so the timer lands on the boundary.
  const justBefore = new Date(nyAt(6, 59).getTime() + 250);
  assert.equal(msUntilNextMarkBoundary(NY, justBefore), 1 * m - 250);
});
