import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMAIL_CONFIRMED_NOTICE,
  LINK_ERRORS,
  linkErrorMessage,
  linkOutcomePath,
  type LinkOutcome,
} from "./linkOutcome";

const OUTCOMES: LinkOutcome[] = [
  "confirmed",
  "reset-other-browser",
  "reset-expired",
  "incomplete",
  "failed",
];

test("a confirmed signup is a notice, never an error", () => {
  const path = linkOutcomePath("confirmed", false);
  assert.equal(path, "/login?notice=email_confirmed");
  assert.ok(!path.includes("error="));
  assert.equal(EMAIL_CONFIRMED_NOTICE, "Your email is confirmed. Log in to continue.");
});

test("signup outcomes land on /login, recovery outcomes on /forgot-password", () => {
  assert.match(linkOutcomePath("failed", false), /^\/login\?/);
  assert.match(linkOutcomePath("incomplete", false), /^\/login\?/);
  for (const outcome of ["reset-other-browser", "reset-expired", "failed", "incomplete"] as const) {
    assert.match(linkOutcomePath(outcome, true), /^\/forgot-password\?error=/);
  }
});

test("every error a path names has copy, and each cause gets its own", () => {
  const keys = new Set<string>();
  for (const outcome of OUTCOMES) {
    for (const isRecovery of [false, true]) {
      const url = new URL(linkOutcomePath(outcome, isRecovery), "http://x");
      const error = url.searchParams.get("error");
      if (error === null) continue;
      assert.ok(linkErrorMessage(error), `no copy for ${error}`);
      keys.add(error);
    }
  }
  assert.deepEqual([...keys].sort(), Object.keys(LINK_ERRORS).sort());
});

test('only otp_expired outcomes say "expired or used"', () => {
  for (const [key, copy] of Object.entries(LINK_ERRORS)) {
    if (key === "reset_expired") continue;
    assert.doesNotMatch(copy, /expired|already used/i, key);
  }
});

test("no link copy shouts", () => {
  for (const copy of [...Object.values(LINK_ERRORS), EMAIL_CONFIRMED_NOTICE]) {
    assert.ok(!copy.includes("!"), copy);
  }
});

test("an unknown or repeated ?error= shows nothing", () => {
  assert.equal(linkErrorMessage(undefined), undefined);
  assert.equal(linkErrorMessage("confirmation_failed"), undefined);
  assert.equal(linkErrorMessage("toString"), undefined);
  assert.equal(linkErrorMessage(["link_failed", "link_failed"]), undefined);
});
