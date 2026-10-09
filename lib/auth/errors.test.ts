import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { authErrorMessage } from "./errors";
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
