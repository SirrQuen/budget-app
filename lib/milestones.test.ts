import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonthsISO,
  dateInZone,
  earned,
  isMilestoneId,
  LOG_THRESHOLDS,
  logMilestoneId,
  sortEarned,
  timeMilestones,
} from "./milestones";
import { CELEBRATED_KEY, claimCelebration, INITIALISED_KEY, syncCelebrations, type DeviceStorage } from "./milestonesCelebrated";

function memory(initial: Record<string, string> = {}): DeviceStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

test("the log thresholds are the doc's: 1, 10, 100, 500, 1000", () => {
  assert.deepEqual([...LOG_THRESHOLDS], [1, 10, 100, 500, 1000]);
  assert.equal(logMilestoneId(100), "log-100");
  assert.equal(logMilestoneId(50), null);
});

test("calendar months clamp to the month's last day", () => {
  assert.equal(addMonthsISO("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsISO("2026-11-18", 3), "2027-02-18");
  assert.equal(addMonthsISO("2026-11-18", 12), "2027-11-18");
  assert.equal(addMonthsISO("2024-01-31", 1), "2024-02-29");
});

test("time milestones are earned only once their day arrives, dated that day", () => {
  const created = "2026-10-18T15:00:00Z";
  assert.deepEqual(timeMilestones(created, "2026-11-17", "America/New_York"), []);
  assert.deepEqual(
    timeMilestones(created, "2026-11-18", "America/New_York").map((m) => [m.id, m.date]),
    [["month-1", "2026-11-18"]],
  );
  assert.deepEqual(
    timeMilestones(created, "2027-10-18", "America/New_York").map((m) => m.id),
    ["month-1", "month-3", "year-1"],
  );
});

test("a date is the user's day, not UTC's", () => {
  // 2026-11-16T02:00:00Z is 9pm on the 15th in New York.
  assert.equal(dateInZone("2026-11-16T02:00:00Z", "America/New_York"), "2026-11-15");
  assert.equal(dateInZone("2026-11-16T02:00:00Z", null), "2026-11-16");
  assert.equal(dateInZone("nope", null), null);
  assert.deepEqual(earned("first-import", null, null), []);
});

test("sorted oldest first, a shared day in the set's order", () => {
  const list = [
    ...earned("first-goal", "2026-11-02T12:00:00Z", null),
    ...earned("log-1", "2026-11-02T10:00:00Z", null),
    ...earned("first-import", "2026-10-01T10:00:00Z", null),
  ];
  assert.deepEqual(
    sortEarned(list).map((m) => m.id),
    ["first-import", "log-1", "first-goal"],
  );
});

test("an unknown id is never a milestone", () => {
  assert.equal(isMilestoneId("log-100"), true);
  assert.equal(isMilestoneId("log-7"), false);
});

test("first run on a device: everything earned is marked, nothing celebrated", () => {
  const store = memory();
  assert.deepEqual(syncCelebrations(["log-1", "log-10", "month-1"], store), []);
  assert.equal(store.data[INITIALISED_KEY], "1");
  assert.deepEqual(JSON.parse(store.data[CELEBRATED_KEY]), ["log-1", "log-10", "month-1"]);
});

test("after the first run: only what is new, once", () => {
  const store = memory();
  syncCelebrations(["log-1"], store);
  assert.deepEqual(syncCelebrations(["log-1", "log-10"], store), ["log-10"]);
  // A reload: the same set again celebrates nothing.
  assert.deepEqual(syncCelebrations(["log-1", "log-10"], store), []);
});

test("a save-time celebration claims once, and does not spoil the first run", () => {
  const store = memory();
  assert.equal(claimCelebration("log-100", store), true);
  assert.equal(claimCelebration("log-100", store), false);
  // Not initialised yet: the first dashboard sync still marks the rest silently.
  assert.deepEqual(syncCelebrations(["log-1", "log-10", "log-100"], store), []);
  assert.deepEqual(JSON.parse(store.data[CELEBRATED_KEY]).sort(), ["log-1", "log-10", "log-100"]);
});

test("storage unavailable: the dashboard stays quiet, a crossing save still says so once", () => {
  assert.deepEqual(syncCelebrations(["log-1"], null), []);
  assert.equal(claimCelebration("log-10", null), true);
  const throwing: DeviceStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(syncCelebrations(["log-1"], throwing), []);
});

test("a damaged record reads as empty", () => {
  const store = memory({ [CELEBRATED_KEY]: "{not json", [INITIALISED_KEY]: "1" });
  assert.deepEqual(syncCelebrations(["log-1"], store), ["log-1"]);
});
