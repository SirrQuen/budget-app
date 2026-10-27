import { test } from "node:test";
import assert from "node:assert/strict";
import { markWelcomed, readWelcomed, welcomeDay, withWelcome, type WelcomeStorage } from "./welcome";

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
