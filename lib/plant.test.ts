import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLANT_SEEN_KEY,
  planPlant,
  plantStamp,
  plantStateAt,
  plantStateForHour,
  readPlantSeen,
  writePlantSeen,
} from "./plant";
import { hourInZone } from "./timeOfDay";
import { afterPlant, isPlantBusy, setPlantBusy } from "./plantSignals";

// The roselle is open 7:00-18:59 and closed 19:00-6:59 in the user's stored
// zone -- the boundaries, in two zones a day apart.

const NY = "America/New_York"; // EST, UTC-5, on 2026-11-22
const TOKYO = "Asia/Tokyo"; // UTC+9

test("open from 7:00 to 18:59, closed from 19:00 to 6:59", () => {
  assert.equal(plantStateForHour(6), "closed");
  assert.equal(plantStateForHour(7), "open");
  assert.equal(plantStateForHour(18), "open");
  assert.equal(plantStateForHour(19), "closed");
  assert.equal(plantStateForHour(0), "closed");
  assert.equal(plantStateForHour(23), "closed");
});

test("the boundaries in New York, read from the stored zone", () => {
  assert.equal(plantStateAt(NY, new Date("2026-11-22T11:59:00Z")), "closed"); // 6:59
  assert.equal(plantStateAt(NY, new Date("2026-11-22T12:00:00Z")), "open"); // 7:00
  assert.equal(plantStateAt(NY, new Date("2026-11-22T23:59:00Z")), "open"); // 18:59
  assert.equal(plantStateAt(NY, new Date("2026-11-23T00:00:00Z")), "closed"); // 19:00
});

test("the boundaries in Tokyo, a day ahead of New York", () => {
  assert.equal(plantStateAt(TOKYO, new Date("2026-11-21T21:59:00Z")), "closed"); // 6:59
  assert.equal(plantStateAt(TOKYO, new Date("2026-11-21T22:00:00Z")), "open"); // 7:00
  assert.equal(plantStateAt(TOKYO, new Date("2026-11-22T09:59:00Z")), "open"); // 18:59
  assert.equal(plantStateAt(TOKYO, new Date("2026-11-22T10:00:00Z")), "closed"); // 19:00
});

test("no stored zone is UTC, and an unknown zone is UTC too", () => {
  assert.equal(plantStateAt(null, new Date("2026-11-22T07:00:00Z")), "open");
  assert.equal(plantStateAt("Not/AZone", new Date("2026-11-22T06:59:00Z")), "closed");
});

test("one clock: the plant reads the same hour lib/timeOfDay gives the glow", () => {
  const now = new Date("2026-11-22T12:00:00Z");
  assert.equal(hourInZone(NY, now), 7);
  assert.equal(plantStateAt(NY, now), "open");
});

test("a night is one change: the small hours carry the evening's date", () => {
  assert.equal(plantStamp("2026-11-22", 19), "2026-11-22:closed");
  assert.equal(plantStamp("2026-11-22", 23), "2026-11-22:closed");
  assert.equal(plantStamp("2026-11-23", 0), "2026-11-22:closed");
  assert.equal(plantStamp("2026-11-23", 6), "2026-11-22:closed");
  assert.equal(plantStamp("2026-11-23", 7), "2026-11-23:open");
  assert.equal(plantStamp("2026-11-23", 18), "2026-11-23:open");
  assert.equal(plantStamp("2026-12-01", 3), "2026-11-30:closed");
});

test("plays once per change: unseen plays, seen rests, the next change plays again", () => {
  assert.equal(planPlant(null, "2026-11-22:open", false), "play");
  assert.equal(planPlant("2026-11-22:open", "2026-11-22:open", false), "rest");
  assert.equal(planPlant("2026-11-22:open", "2026-11-22:closed", false), "play");
  assert.equal(planPlant("2026-11-22:closed", "2026-11-23:open", false), "play");
  assert.equal(planPlant("2026-11-22:closed", "2026-11-22:closed", false), "rest");
});

test("reduced motion and unreadable storage rest, whatever was stored", () => {
  assert.equal(planPlant(null, "2026-11-22:open", true), "rest");
  assert.equal(planPlant("2026-11-21:closed", "2026-11-22:open", true), "rest");
  assert.equal(planPlant(undefined, "2026-11-22:open", false), "rest");
});

test("storage that throws reads as unavailable and writes as failed, never an exception", () => {
  const broken = () => {
    throw new Error("SecurityError");
  };
  assert.equal(readPlantSeen(broken), undefined);
  assert.equal(writePlantSeen("2026-11-22:open", broken), false);
  const readOnly = () => ({ getItem: () => null, setItem: broken }) as unknown as Storage;
  assert.equal(readPlantSeen(readOnly), null);
  assert.equal(writePlantSeen("2026-11-22:open", readOnly), false);
});

test("round trip through storage under sorrel-plant-seen", () => {
  const map = new Map<string, string>();
  const storage = () =>
    ({
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    }) as unknown as Storage;
  assert.equal(PLANT_SEEN_KEY, "sorrel-plant-seen");
  assert.equal(readPlantSeen(storage), null);
  assert.equal(writePlantSeen("2026-11-22:open", storage), true);
  assert.equal(map.get("sorrel-plant-seen"), "2026-11-22:open");
  assert.equal(readPlantSeen(storage), "2026-11-22:open");
});

test("afterPlant: now if idle; held while busy; once; cancellable", () => {
  let n = 0;
  afterPlant(() => n++);
  assert.equal(n, 1);

  setPlantBusy(true);
  assert.equal(isPlantBusy(), true);
  afterPlant(() => n++);
  const cancel = afterPlant(() => n++);
  cancel();
  assert.equal(n, 1);
  setPlantBusy(false);
  assert.equal(n, 2);
  setPlantBusy(false);
  assert.equal(n, 2);
});
