import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { paydaySkipCookie, PAYDAY_SKIP_COOKIE } from "./paydaySkip";

// paydaySkipToken.ts is "server-only"; outside Next that marker is an empty module.
type Next<A, R> = (arg: A, context: unknown) => R;
type HookResult = { url?: string; format?: string; source?: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve(specifier: string, context: unknown, nextResolve: Next<string, HookResult>): HookResult;
    load(url: string, context: unknown, nextLoad: Next<string, HookResult>): HookResult;
  }): void;
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "stub:server-only", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "stub:server-only") return { format: "commonjs", source: "", shortCircuit: true };
    return nextLoad(url, context);
  },
});

const A = "7e9a84e3-90b3-4cca-b6d1-d640128a77d8";
const B = "11111111-2222-3333-4444-555555555555";

test("the skip is keyed to the user, by a hash -- never the id itself", async () => {
  const { paydaySkipToken, paydaySkipped } = await import("./paydaySkipToken");
  const token = paydaySkipToken(A);
  assert.match(token, /^[0-9a-f]{16}$/);
  assert.equal(paydaySkipToken(A), token, "stable");
  assert.notEqual(paydaySkipToken(B), token);
  assert.ok(!token.includes(A.slice(0, 8)));
  assert.equal(paydaySkipped(token, A), true);
  assert.equal(paydaySkipped(token, B), false, "one person's skip never carries to the next");
  assert.equal(paydaySkipped(undefined, A), false);
  assert.equal(paydaySkipped("1", A), false);
});

test("paydaySkipCookie: a year, site-wide, lax, secure on https", () => {
  assert.equal(
    paydaySkipCookie("abc", true),
    `${PAYDAY_SKIP_COOKIE}=abc; path=/; max-age=31536000; samesite=lax; secure`,
  );
  assert.ok(!paydaySkipCookie("abc", false).includes("secure"));
});
