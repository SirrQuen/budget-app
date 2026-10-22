import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseWaitlistEmail, WAITLIST_EMAIL_MAX } from "./waitlistValidation";

test("trims and lower-cases, so one person is one row", () => {
  assert.deepEqual(normaliseWaitlistEmail("  Ann.Lee@Example.COM \n"), {
    email: "ann.lee@example.com",
    error: null,
  });
});

test("rejects anything that isn't a plausible address", () => {
  for (const raw of [
    "",
    "   ",
    "ann",
    "ann@",
    "@example.com",
    "ann@example",
    "ann lee@example.com",
    "ann@@example.com",
    "ann@exa mple.com",
    null,
    undefined,
    42,
    ["ann@example.com"],
  ]) {
    assert.equal(normaliseWaitlistEmail(raw).email, null, JSON.stringify(raw));
  }
});

test("blank gets its own message", () => {
  assert.equal(normaliseWaitlistEmail(" ").error, "Enter your email address.");
});

test("over the length ceiling is rejected", () => {
  const atLimit = "a".repeat(WAITLIST_EMAIL_MAX - "@example.com".length) + "@example.com";
  assert.equal(normaliseWaitlistEmail(atLimit).email, atLimit);
  assert.equal(normaliseWaitlistEmail("a" + atLimit).email, null);
});
