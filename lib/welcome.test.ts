import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimDailyWelcome,
  dailyGreeting,
  hourInZone,
  markWelcomed,
  readWelcomed,
  welcomeDay,
  withWelcome,
  type WelcomeStorage,
} from "./welcome";

function memoryStorage(): WelcomeStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const throwing = (): WelcomeStorage => {
  throw new DOMException("blocked", "SecurityError");
};

test("withWelcome adds the confirmed welcome and keeps the path's own query", () => {
  assert.equal(withWelcome("/dashboard"), "/dashboard?welcome=confirmed");
  assert.equal(withWelcome("/dashboard?range=30d"), "/dashboard?range=30d&welcome=confirmed");
});

test("welcomeDay is the user's calendar day, never UTC's", () => {
  // 8:30pm EDT on Oct 27 is already Oct 28 in UTC.
  const evening = new Date("2026-10-28T00:30:00Z");
  assert.equal(welcomeDay("America/New_York", "UTC", evening), "2026-10-27");
});

test("11:55pm and 12:05am local are two days", () => {
  const before = new Date("2026-10-28T03:55:00Z"); // 11:55pm EDT, Oct 27
  const after = new Date("2026-10-28T04:05:00Z"); // 12:05am EDT, Oct 28
  assert.equal(welcomeDay("America/New_York", "UTC", before), "2026-10-27");
  assert.equal(welcomeDay("America/New_York", "UTC", after), "2026-10-28");
});

test("no stored zone yet (a brand-new user): the browser's zone, not UTC", () => {
  const evening = new Date("2026-10-28T00:30:00Z");
  assert.equal(welcomeDay(null, "America/New_York", evening), "2026-10-27");
});

test("the mark is per user", () => {
  const storage = memoryStorage();
  markWelcomed(() => storage, "a", "2026-10-27");
  assert.equal(readWelcomed(() => storage, "a"), "2026-10-27");
  assert.equal(readWelcomed(() => storage, "b"), null);
});

test("blocked storage never throws: read is undefined, write reports false", () => {
  assert.equal(readWelcomed(throwing, "a"), undefined);
  assert.equal(markWelcomed(throwing, "a", "2026-10-27"), false);
});

const claim = (
  storage: () => WelcomeStorage,
  day: string,
  over: { enabled?: boolean; reducedMotion?: boolean } = {},
) => claimDailyWelcome({ enabled: true, reducedMotion: false, storage, userId: "u", day, ...over });

const nyDay = (iso: string) => welcomeDay("America/New_York", "UTC", new Date(iso));

test("daily: twice the same day blooms once; the next day blooms again", () => {
  const storage = memoryStorage();
  assert.equal(claim(() => storage, "2026-10-27"), true);
  assert.equal(claim(() => storage, "2026-10-27"), false);
  assert.equal(claim(() => storage, "2026-10-28"), true);
});

test("daily: the day is marked when it STARTS, so a refresh mid-bloom doesn't replay it", () => {
  const storage = memoryStorage();
  claim(() => storage, "2026-10-27");
  assert.equal(readWelcomed(() => storage, "u"), "2026-10-27");
});

test("daily: 11:55pm then 12:05am local is two blooms", () => {
  const storage = memoryStorage();
  assert.equal(claim(() => storage, nyDay("2026-10-28T03:55:00Z")), true);
  assert.equal(claim(() => storage, nyDay("2026-10-28T04:05:00Z")), true);
});

test("daily: 7:55pm then 8:05pm EDT is one bloom -- UTC's midnight isn't the user's", () => {
  const storage = memoryStorage();
  assert.equal(claim(() => storage, nyDay("2026-10-27T23:55:00Z")), true);
  assert.equal(claim(() => storage, nyDay("2026-10-28T00:05:00Z")), false);
});

test("daily: blocked storage means don't play, every time", () => {
  assert.equal(claim(throwing, "2026-10-27"), false);
  assert.equal(claim(throwing, "2026-10-28"), false);
});

test("daily: storage that reads but won't keep the mark means don't play", () => {
  const readOnly: WelcomeStorage = {
    getItem: () => null,
    setItem: () => {
      throw new DOMException("full", "QuotaExceededError");
    },
  };
  assert.equal(claim(() => readOnly, "2026-10-27"), false);
});

test("daily: reduced motion skips it entirely and leaves the day unmarked", () => {
  const storage = memoryStorage();
  assert.equal(claim(() => storage, "2026-10-27", { reducedMotion: true }), false);
  assert.equal(readWelcomed(() => storage, "u"), null);
});

test("daily: the constant turns it off", () => {
  assert.equal(claim(() => memoryStorage(), "2026-10-27", { enabled: false }), false);
});

test("daily: a confirmed signup's mark suppresses the daily welcome that day", () => {
  const storage = memoryStorage();
  markWelcomed(() => storage, "u", "2026-10-27");
  assert.equal(claim(() => storage, "2026-10-27"), false);
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
});
