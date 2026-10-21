import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { authErrorMessage, confirmFailure } from "./errors";
import { UNREACHABLE } from "@/lib/unreachable";

// GoTrue's raw messages name its internals; none may reach a form. Each
// case also checks the raw message still reaches the server log.

function silenceLog(t: TestContext): string[] {
  const logged: string[] = [];
  t.mock.method(console, "error", (line: string) => logged.push(line));
  return logged;
}

for (const [message, code] of [
  ["Database error saving new user", "unexpected_failure"],
  ["Database error querying schema", undefined],
  ["Some brand-new GoTrue error", "not_a_code_we_map"],
] as const) {
  test(`unmapped "${message}": a fixed sentence to the user, the raw text to the log`, (t) => {
    const logged = silenceLog(t);
    const shown = authErrorMessage(new AuthApiError(message, 500, code));
    assert.ok(!shown.includes(message));
    assert.doesNotMatch(shown, /database|schema/i);
    assert.ok(logged.some((line) => line.includes(message)));
  });
}

test("auth server unreachable: our outage, never the raw 'fetch failed'", (t) => {
  const logged = silenceLog(t);
  const shown = authErrorMessage(new AuthRetryableFetchError("fetch failed", 0));
  assert.equal(shown, UNREACHABLE);
  assert.ok(logged.some((line) => line.includes("fetch failed")));
});

test("a mapped code keeps its specific copy", () => {
  const shown = authErrorMessage(new AuthApiError("Invalid login credentials", 400, "invalid_credentials"));
  assert.equal(shown, "Incorrect email or password.");
});

// --- app/auth/confirm/route.ts ---------------------------------------------

function silenceAll(t: TestContext): string[] {
  const logged = silenceLog(t);
  t.mock.method(console, "info", (line: string) => logged.push(line));
  return logged;
}

for (const link of ["otp", "code"] as const) {
  test(`confirm ${link}: an unreachable auth server is never "already confirmed"`, (t) => {
    const logged = silenceAll(t);
    for (const isRecovery of [false, true]) {
      const outcome = confirmFailure(new AuthRetryableFetchError("fetch failed", 0), link, isRecovery);
      assert.equal(outcome, "unreachable");
    }
    assert.ok(logged.some((line) => line.includes("fetch failed")));
  });
}

// The OTP is verified only by the interstitial's POST, so a scanner can't
// have spent it first: an expired-or-used token is a real failure, and
// never "your email is confirmed". The code stays in the log line.
test("confirm: an expired or spent signup OTP says so, never confirmed", (t) => {
  const logged = silenceAll(t);
  const expired = new AuthApiError("Token has expired or is invalid", 403, "otp_expired");
  assert.equal(confirmFailure(expired, "otp", false), "expired");
  assert.ok(logged.some((line) => line.includes("otp_expired")));
});

test("confirm: any other signup OTP failure fails, logged with its code", (t) => {
  const logged = silenceAll(t);
  const odd = new AuthApiError("Something unexpected", 500, "unexpected_failure");
  assert.equal(confirmFailure(odd, "otp", false), "failed");
  assert.ok(logged.some((line) => line.includes("unexpected_failure")));
});

test("confirm: no signup OTP failure is ever reported as confirmed", (t) => {
  silenceAll(t);
  for (const code of ["otp_expired", "pkce_code_verifier_not_found", "flow_state_not_found", "validation_failed"]) {
    const error = new AuthApiError("x", 400, code);
    assert.notEqual(confirmFailure(error, "otp", false), "confirmed", code);
  }
});

// The cross-device case: signed up on a laptop, opened the email on a phone.
// auth-js raises pkce_code_verifier_not_found itself, before any request;
// GoTrue's codes cover the same case server-side. Supabase confirmed the
// address before issuing the code, so this is success, never "failed".
for (const code of [
  "pkce_code_verifier_not_found",
  "bad_code_verifier",
  "flow_state_not_found",
  "flow_state_expired",
]) {
  test(`confirm code ${code}: a signup link is confirmed, not failed`, (t) => {
    const logged = silenceLog(t);
    t.mock.method(console, "info", () => {});
    const noVerifier = new AuthApiError("PKCE code verifier not found in storage", 400, code);
    assert.equal(confirmFailure(noVerifier, "code", false), "confirmed");
    assert.deepEqual(logged, [], "a confirmed signup is not an error");
  });

  test(`confirm code ${code}: a recovery link asks for a new one on this device`, (t) => {
    silenceAll(t);
    const noVerifier = new AuthApiError("PKCE code verifier not found in storage", 400, code);
    assert.equal(confirmFailure(noVerifier, "code", true), "reset-other-browser");
  });
}

test("confirm: an expired or spent recovery OTP says exactly that", (t) => {
  silenceAll(t);
  const expired = new AuthApiError("Token has expired or is invalid", 403, "otp_expired");
  assert.equal(confirmFailure(expired, "otp", true), "reset-expired");
});

test("confirm: any other recovery failure fails, and is logged", (t) => {
  const logged = silenceAll(t);
  const odd = new AuthApiError("Something unexpected", 500, "unexpected_failure");
  assert.equal(confirmFailure(odd, "otp", true), "failed");
  assert.equal(confirmFailure(odd, "code", true), "failed");
  assert.ok(logged.some((line) => line.includes("Something unexpected")));
});

test("confirm: a malformed code fails rather than claiming confirmation", (t) => {
  silenceAll(t);
  const bad = new AuthApiError("invalid code", 400, "validation_failed");
  assert.equal(confirmFailure(bad, "code", false), "failed");
});
