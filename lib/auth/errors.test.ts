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

test("confirm: a spent signup link is already confirmed", (t) => {
  silenceAll(t);
  const expired = new AuthApiError("Token has expired or is invalid", 403, "otp_expired");
  assert.equal(confirmFailure(expired, "otp", false), "already-confirmed");
  const noVerifier = new AuthApiError("code verifier missing", 400, "bad_code_verifier");
  assert.equal(confirmFailure(noVerifier, "code", false), "already-confirmed");
});

test("confirm: a spent recovery link fails, and is logged", (t) => {
  const logged = silenceAll(t);
  const expired = new AuthApiError("Token has expired or is invalid", 403, "otp_expired");
  assert.equal(confirmFailure(expired, "otp", true), "failed");
  assert.ok(logged.some((line) => line.includes("Token has expired")));
});

test("confirm: a malformed code fails rather than claiming confirmation", (t) => {
  silenceAll(t);
  const bad = new AuthApiError("invalid code", 400, "validation_failed");
  assert.equal(confirmFailure(bad, "code", false), "failed");
});
