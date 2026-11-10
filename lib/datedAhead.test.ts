import { test } from "node:test";
import assert from "node:assert/strict";
import { DATED_AHEAD_MAX_REMEMBERED, isDatedAhead, readRemembered, settleRows } from "./datedAhead";

test("dated ahead: after today only; today itself counts", () => {
  assert.equal(isDatedAhead("2026-11-11", "2026-11-10"), true);
  assert.equal(isDatedAhead("2026-11-10", "2026-11-10"), false);
  assert.equal(isDatedAhead("2026-11-09", "2026-11-10"), false);
});

test("dated ahead: the boundary is the user's day -- 11:55pm in New York is still the 10th", () => {
  // At 2026-11-11T04:55Z the UTC day is the 11th; the user's is the 10th.
  // useToday() hands the list the user's day, so tomorrow's row stays ahead.
  const usersToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date("2026-11-11T04:55:00Z"),
  );
  assert.equal(usersToday, "2026-11-10");
  assert.equal(isDatedAhead("2026-11-11", usersToday), true);
});

test("settle: a remembered row that's no longer ahead settles once, then is forgotten", () => {
  const first = settleRows([], [{ key: "a", datedAhead: true }]);
  assert.deepEqual(first, { settling: [], remember: ["a"] });

  const onItsDate = settleRows(first.remember, [{ key: "a", datedAhead: false }]);
  assert.deepEqual(onItsDate, { settling: ["a"], remember: [] });

  const again = settleRows(onItsDate.remember, [{ key: "a", datedAhead: false }]);
  assert.deepEqual(again.settling, []);
});

test("settle: a row never seen ahead in this browser doesn't animate", () => {
  assert.deepEqual(settleRows([], [{ key: "b", datedAhead: false }]).settling, []);
});

test("settle: ids off screen are kept, bounded", () => {
  const many = Array.from({ length: DATED_AHEAD_MAX_REMEMBERED }, (_, i) => `x${i}`);
  const r = settleRows(many, [{ key: "new", datedAhead: true }]);
  assert.equal(r.remember.length, DATED_AHEAD_MAX_REMEMBERED);
  assert.equal(r.remember.at(-1), "new");
  assert.equal(r.remember.includes("x0"), false);
});

test("readRemembered tolerates missing or garbled storage", () => {
  assert.deepEqual(readRemembered(null), []);
  assert.deepEqual(readRemembered("{"), []);
  assert.deepEqual(readRemembered('["a",1]'), ["a"]);
});
