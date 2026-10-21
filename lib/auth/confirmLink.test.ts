import { test } from "node:test";
import assert from "node:assert/strict";
import { interstitialPath, isRecoveryLink, readOtpLink, safeNext } from "./confirmLink";

const params = (query: string) => new URLSearchParams(query);

test("a token_hash link is read with its type and next", () => {
  assert.deepEqual(readOtpLink(params("token_hash=abc&type=email")), {
    tokenHash: "abc",
    type: "email",
    next: "/dashboard",
  });
  assert.equal(readOtpLink(params("token_hash=abc&type=recovery&next=/reset-password"))?.next, "/reset-password");
});

test("a missing token, a missing type or an unknown type is no link", () => {
  assert.equal(readOtpLink(params("type=email")), null);
  assert.equal(readOtpLink(params("token_hash=abc")), null);
  assert.equal(readOtpLink(params("token_hash=abc&type=sms")), null);
  assert.equal(readOtpLink(params("token_hash=abc&type=toString")), null);
});

test("next is only ever an in-app path", () => {
  assert.equal(safeNext("https://evil.example/"), "/dashboard");
  assert.equal(safeNext("//evil.example/"), "/dashboard");
  assert.equal(safeNext(null), "/dashboard");
  assert.equal(safeNext("/goals"), "/goals");
});

test("the interstitial path carries the link unchanged, and reads back the same", () => {
  const link = { tokenHash: "a+b/c=", type: "email" as const, next: "/dashboard" };
  const path = interstitialPath(link);
  assert.match(path, /^\/confirm-email\?/);
  assert.deepEqual(readOtpLink(new URL(path, "http://x").searchParams), link);
});

test("recovery is the recovery type or a /reset-password destination", () => {
  assert.equal(isRecoveryLink("recovery", "/dashboard"), true);
  assert.equal(isRecoveryLink(null, "/reset-password"), true);
  assert.equal(isRecoveryLink("email", "/dashboard"), false);
});
