import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countdownAnnouncement,
  formatCountdown,
  formatIdleDuration,
  idlePhase,
  mergeActivity,
  parseActivityRecord,
  resolveIdleConfig,
  signedOutElsewhere,
  signedOutHref,
  timeoutNotice,
} from "./idleTimeout";

const CFG = { warningMs: 10 * 60_000, signOutMs: 15 * 60_000 };
const T0 = 1_760_000_000_000;
const min = (n: number) => n * 60_000;

test("defaults are 10 minutes to the warning and 15 to sign-out", () => {
  assert.deepEqual(resolveIdleConfig(undefined, undefined), CFG);
});

test("durations are configurable in seconds, for testing", () => {
  assert.deepEqual(resolveIdleConfig("30", "60"), { warningMs: 30_000, signOutMs: 60_000 });
});

test("an invalid pair falls back to the defaults rather than a broken timer", () => {
  assert.deepEqual(resolveIdleConfig("60", "30"), CFG); // warning after sign-out
  assert.deepEqual(resolveIdleConfig("abc", "-5"), CFG);
});

test("phase comes from elapsed time alone: active, then warning, then expired", () => {
  assert.deepEqual(idlePhase(T0 + min(9), T0, CFG), { kind: "active" });
  assert.deepEqual(idlePhase(T0 + min(10), T0, CFG), { kind: "warning", remainingMs: min(5) });
  assert.deepEqual(idlePhase(T0 + min(15), T0, CFG), { kind: "expired" });
});

test("three hours asleep is expired at once -- no countdown resumes", () => {
  assert.deepEqual(idlePhase(T0 + min(180), T0, CFG), { kind: "expired" });
});

test("a clock that went backwards reads as active, never expired", () => {
  assert.deepEqual(idlePhase(T0 - min(5), T0, CFG), { kind: "active" });
});

test("another tab's later activity is adopted; an earlier one never moves the clock back", () => {
  const record = { sessionId: "s1", at: T0 + min(5) };
  assert.equal(mergeActivity(T0, record, "s1"), T0 + min(5));
  assert.equal(mergeActivity(T0 + min(8), record, "s1"), T0 + min(8));
});

test("a timestamp from another session is ignored -- an old sign-in can't time out a new one", () => {
  const stale = { sessionId: "old", at: T0 - min(180) };
  assert.equal(mergeActivity(T0, stale, "new"), T0);
  assert.equal(signedOutElsewhere({ ...stale, signedOut: "timeout" }, "new"), null);
});

test("a tab follows another tab of its session out, with the same reason", () => {
  assert.equal(signedOutElsewhere({ sessionId: "s1", at: T0, signedOut: "timeout" }, "s1"), "timeout");
  assert.equal(signedOutElsewhere({ sessionId: "s1", at: T0, signedOut: "manual" }, "s1"), "manual");
  assert.equal(signedOutElsewhere({ sessionId: "s1", at: T0 }, "s1"), null);
  assert.equal(signedOutHref("timeout"), "/login?reason=timeout");
  assert.equal(signedOutHref("manual"), "/login");
});

test("a malformed or foreign record parses to null", () => {
  assert.equal(parseActivityRecord(null), null);
  assert.equal(parseActivityRecord("not json"), null);
  assert.equal(parseActivityRecord('{"at":1}'), null);
  assert.equal(parseActivityRecord('{"sessionId":"s","at":"soon"}'), null);
  assert.deepEqual(parseActivityRecord('{"sessionId":"s","at":5,"signedOut":true}'), { sessionId: "s", at: 5 });
});

test("the countdown reads M:SS and rounds up, so it never shows 0:00 early", () => {
  assert.equal(formatCountdown(min(5)), "5:00");
  assert.equal(formatCountdown(298_000), "4:58");
  assert.equal(formatCountdown(297_200), "4:58");
  assert.equal(formatCountdown(400), "0:01");
});

test("screen readers hear the countdown at intervals, not every second", () => {
  const announced = [];
  for (let s = 300; s >= 1; s--) {
    if (countdownAnnouncement(s)) announced.push(s);
  }
  assert.deepEqual(announced, [300, 240, 180, 120, 60, 30, 10]);
  assert.equal(countdownAnnouncement(60), "1 minute until you're signed out.");
});

test("the login page names what happened, in the configured duration", () => {
  assert.equal(timeoutNotice(CFG), "You were signed out after 15 minutes of inactivity.");
  assert.equal(timeoutNotice({ warningMs: 30_000, signOutMs: 60_000 }), "You were signed out after 1 minute of inactivity.");
  assert.equal(formatIdleDuration(45_000), "45 seconds");
});
