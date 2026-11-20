import { test } from "node:test";
import assert from "node:assert/strict";
import { timeBandAt, type TimeBand } from "./timeOfDay";
import {
  VISITORS_OFF_KEY,
  VISITOR_AWAY_KEY,
  VISITOR_SEEN_KEY,
  bandStamp,
  hasRoom,
  planVisitor,
  readVisitorState,
  visitorForBand,
  writeVisitorKey,
  type VisitorState,
} from "./visitors";

const fresh: VisitorState = { seen: null, away: null, off: null, storageOk: true };

test("each band has its own visitor", () => {
  assert.equal(visitorForBand("morning"), "songbird");
  assert.equal(visitorForBand("afternoon"), "butterfly");
  assert.equal(visitorForBand("evening"), "firefly");
  assert.equal(visitorForBand("night"), "owl");
});

// An instant, read in a zone, lands in a band; the visitor follows the band.
// 2026-11-20T<utc> is chosen so the two zones disagree about the hour.
test("every boundary, in two timezones, picks the greeting's visitor", () => {
  const zones: [string, number][] = [
    ["UTC", 0],
    ["America/New_York", -5], // EST in November
  ];
  const cases: [number, TimeBand][] = [
    [4, "night"], // 4:59 is hour 4
    [5, "morning"],
    [11, "morning"], // 11:59
    [12, "afternoon"],
    [16, "afternoon"], // 16:59
    [17, "evening"],
    [21, "evening"], // 21:59
    [22, "night"],
  ];
  const owner: Record<TimeBand, string> = { morning: "songbird", afternoon: "butterfly", evening: "firefly", night: "owl" };
  for (const [zone, offset] of zones) {
    for (const [hour, band] of cases) {
      for (const minute of [0, 59]) {
        // Local wall clock `hour:minute` on 2026-11-20, as a UTC instant.
        const utcHour = hour - offset;
        const now = new Date(Date.UTC(2026, 10, 20, utcHour, minute, 30));
        assert.equal(timeBandAt(zone, now), band, `${zone} ${hour}:${minute}`);
        assert.equal(visitorForBand(timeBandAt(zone, now)), owner[band]);
      }
    }
  }
});

test("a first visit to a band arrives", () => {
  assert.equal(planVisitor(fresh, "2026-11-20", "morning", false), "arrive");
});

test("the same band later the same day is perched", () => {
  const seen = { ...fresh, seen: bandStamp("2026-11-20", "morning") };
  assert.equal(planVisitor(seen, "2026-11-20", "morning", false), "perched");
});

test("a new band brings the next visitor; a new day brings it again", () => {
  const seen = { ...fresh, seen: bandStamp("2026-11-20", "morning") };
  assert.equal(planVisitor(seen, "2026-11-20", "afternoon", false), "arrive");
  assert.equal(planVisitor(seen, "2026-11-21", "morning", false), "arrive");
});

test("sent away: gone for that band, back for the next band and the next day", () => {
  const away = { ...fresh, away: bandStamp("2026-11-20", "morning"), seen: bandStamp("2026-11-20", "morning") };
  assert.equal(planVisitor(away, "2026-11-20", "morning", false), "none");
  assert.equal(planVisitor(away, "2026-11-20", "afternoon", false), "arrive");
  assert.equal(planVisitor(away, "2026-11-21", "morning", false), "arrive");
});

test("sent away beats everything else, reduced motion included", () => {
  const away = { ...fresh, away: bandStamp("2026-11-20", "night") };
  assert.equal(planVisitor(away, "2026-11-20", "night", true), "none");
});

test("the Settings toggle off hides every visitor", () => {
  const off = { ...fresh, off: "1" };
  for (const band of ["morning", "afternoon", "evening", "night"] as const) {
    assert.equal(planVisitor(off, "2026-11-20", band, false), "none");
  }
});

test("any other stored toggle value means on", () => {
  assert.equal(planVisitor({ ...fresh, off: "0" }, "2026-11-20", "morning", false), "arrive");
  assert.equal(planVisitor({ ...fresh, off: "" }, "2026-11-20", "morning", false), "arrive");
});

test("reduced motion: perched, never an arrival", () => {
  assert.equal(planVisitor(fresh, "2026-11-20", "morning", true), "perched");
});

test("storage unavailable: perched, no arrival", () => {
  const blocked = { seen: null, away: null, off: null, storageOk: false };
  assert.equal(planVisitor(blocked, "2026-11-20", "morning", false), "perched");
});

// --- storage ----------------------------------------------------------------

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}
const blockedStorage = (): Storage => {
  throw new Error("blocked");
};

test("the three keys round-trip", () => {
  const s = memoryStorage();
  assert.equal(writeVisitorKey(VISITOR_SEEN_KEY, "2026-11-20:morning", () => s), true);
  assert.equal(writeVisitorKey(VISITOR_AWAY_KEY, "2026-11-20:night", () => s), true);
  assert.equal(writeVisitorKey(VISITORS_OFF_KEY, "1", () => s), true);
  assert.deepEqual(readVisitorState(() => s), {
    seen: "2026-11-20:morning",
    away: "2026-11-20:night",
    off: "1",
    storageOk: true,
  });
  assert.equal(writeVisitorKey(VISITORS_OFF_KEY, null, () => s), true);
  assert.equal(readVisitorState(() => s).off, null);
});

test("blocked storage never throws", () => {
  assert.deepEqual(readVisitorState(blockedStorage), { seen: null, away: null, off: null, storageOk: false });
  assert.equal(writeVisitorKey(VISITOR_SEEN_KEY, "x", blockedStorage), false);
});

test("storage that throws on read (getItem) is storage unavailable", () => {
  const throwing = {
    getItem() {
      throw new Error("denied");
    },
  } as unknown as Storage;
  assert.equal(readVisitorState(() => throwing).storageOk, false);
});

// --- room ---------------------------------------------------------------------

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

test("room: clear of every box means it renders", () => {
  assert.equal(hasRoom(box(300, 0, 400, 80), [box(0, 0, 200, 30), box(0, 40, 280, 80)]), true);
});

test("room: any overlap means it doesn't", () => {
  assert.equal(hasRoom(box(300, 0, 400, 80), [box(250, 40, 320, 80)]), false);
});

test("room: closer than the clearance counts as no room", () => {
  assert.equal(hasRoom(box(300, 0, 400, 80), [box(0, 40, 295, 80)]), false); // 5px away
  assert.equal(hasRoom(box(300, 0, 400, 80), [box(0, 40, 291, 80)]), true); // 9px away
});

test("room: a box above or below the envelope doesn't block", () => {
  assert.equal(hasRoom(box(300, 100, 400, 180), [box(300, 0, 400, 50), box(300, 200, 400, 260)]), true);
});
