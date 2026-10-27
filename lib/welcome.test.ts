import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dailyGreeting,
  hourInZone,
  parseWelcomeReason,
  shouldWelcomeToday,
  welcomeDay,
  welcomedOnValue,
} from "./welcome";

test("only a known reason is a welcome", () => {
  assert.equal(parseWelcomeReason("confirmed"), "confirmed");
  assert.equal(parseWelcomeReason("daily"), "daily");
  assert.equal(parseWelcomeReason(undefined), null);
  assert.equal(parseWelcomeReason("anything-else"), null);
});

test("the welcomed-on value is per user", () => {
  assert.equal(welcomedOnValue("u1", "2026-10-27"), "u1:2026-10-27");
});

test("welcomeDay is the user's calendar day, never UTC's", () => {
  // 8:30pm EDT on Oct 27 is already Oct 28 in UTC.
  const evening = new Date("2026-10-28T00:30:00Z");
  assert.equal(welcomeDay("America/New_York", null, evening), "2026-10-27");
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

// The daily decision as the sign-in action runs it: each sign-in reads the
// cookie the previous one left.
function signIns(userId: string, instants: string[]): boolean[] {
  let cookie: string | undefined;
  return instants.map((iso) => {
    const day = welcomeDay("America/New_York", null, new Date(iso));
    const play = shouldWelcomeToday(cookie, userId, day);
    if (play) cookie = welcomedOnValue(userId, day);
    return play;
  });
}

test("daily: twice the same day blooms once; the next day blooms again", () => {
  assert.deepEqual(
    signIns("u", ["2026-10-27T13:00:00Z", "2026-10-27T18:00:00Z", "2026-10-28T13:00:00Z"]),
    [true, false, true],
  );
});

test("daily: 11:55pm then 12:05am local is two blooms", () => {
  assert.deepEqual(signIns("u", ["2026-10-28T03:55:00Z", "2026-10-28T04:05:00Z"]), [true, true]);
});

test("daily: 7:55pm then 8:05pm EDT is one bloom -- UTC's midnight isn't the user's", () => {
  assert.deepEqual(signIns("u", ["2026-10-27T23:55:00Z", "2026-10-28T00:05:00Z"]), [true, false]);
});

test("daily: a confirmed signup's mark suppresses the daily welcome that day", () => {
  assert.equal(shouldWelcomeToday(welcomedOnValue("u", "2026-10-27"), "u", "2026-10-27"), false);
});

test("daily: another person's mark on a shared browser doesn't count", () => {
  assert.equal(shouldWelcomeToday(welcomedOnValue("someone-else", "2026-10-27"), "u", "2026-10-27"), true);
});

test("greeting: by local hour, with the name or no name -- never 'there'", () => {
  assert.equal(dailyGreeting(8, "Matt"), "Good morning, Matt.");
  assert.equal(dailyGreeting(12, "Matt"), "Good afternoon, Matt.");
  assert.equal(dailyGreeting(17, "Matt"), "Good evening, Matt.");
  assert.equal(dailyGreeting(8, null), "Good morning.");
});

test("hourInZone reads the wall clock in the zone, UTC for an unknown one", () => {
  assert.equal(hourInZone("America/New_York", new Date("2026-10-28T00:30:00Z")), 20);
  assert.equal(hourInZone("Not/AZone", new Date("2026-10-28T00:30:00Z")), 0);
  assert.equal(hourInZone(null, new Date("2026-10-28T00:30:00Z")), 0);
});
