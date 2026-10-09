import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  classifyDbError,
  describeReadError,
  describeWriteError,
  mustReachUserUnchanged,
  sessionUserId,
} from "./errors";

// These drive the real Supabase client with a stubbed fetch, so they pin
// the error SHAPES the client produces, not just our reading of them. If
// one fails after a @supabase/* upgrade, the client changed how it reports
// a failure: update classifyDbError to match, don't loosen the test.

const URL = "http://supabase.test";

function clientWith(fetch: typeof globalThis.fetch) {
  return createClient(URL, "test-publishable-key", {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// What undici (Node's fetch) throws when it can't connect.
function unreachable(causeCode: string): typeof globalThis.fetch {
  return async () => {
    const cause = Object.assign(new Error(`connect failed (${causeCode})`), { code: causeCode });
    throw new TypeError("fetch failed", { cause });
  };
}

function respond(status: number, body: string): typeof globalThis.fetch {
  return async () => new Response(body, { status, headers: { "content-type": "application/json" } });
}

// The PostgREST error from a select. Retries off: a GET otherwise retries a
// failed fetch with backoff.
async function selectError(fetch: typeof globalThis.fetch) {
  const { error } = await clientWith(fetch).from("accounts").select("id").retry(false);
  assert.ok(error, "expected the select to fail");
  return error;
}

function quiet(t: TestContext) {
  for (const level of ["error", "warn", "info"] as const) {
    t.mock.method(console, level, () => {});
  }
}

// --- The pinned shape -------------------------------------------------------

test("postgrest-js fetch failure: code \"\" with the cause in details", async () => {
  for (const causeCode of ["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND"]) {
    const error = await selectError(unreachable(causeCode));

    // The implementation detail classifyDbError keys on. Asserted
    // separately so a shape change names itself in the failure.
    assert.equal(error.code, "", `${causeCode}: code changed -- see classifyDbError`);
    assert.match(error.details, /Caused by: /, `${causeCode}: details lost the cause`);
    assert.match(error.details, new RegExp(causeCode));

    assert.equal(classifyDbError(error), "network-unreachable", causeCode);
  }
});

test("postgrest-js fetch failure on a write is network-unreachable too", async () => {
  const { error } = await clientWith(unreachable("ECONNREFUSED"))
    .from("accounts")
    .insert({ name: "x" });
  assert.ok(error);
  assert.equal(classifyDbError(error), "network-unreachable");
});

test("an HTTP error with a non-JSON body is not mistaken for a network failure", async () => {
  // A gateway's HTML 502: no code at all, which must not read as "".
  const error = await selectError(respond(502, "<html>Bad Gateway</html>"));
  assert.notEqual(error.code, "");
  assert.equal(classifyDbError(error), "unexpected");
});

// --- PostgREST / Postgres codes, through the real client --------------------

test("PostgREST error bodies classify by code", async () => {
  const cases = [
    [401, "PGRST301", "JWSError JWSInvalidSignature", "auth-expired"],
    [401, "PGRST303", "JWT expired", "auth-expired"],
    [403, "42501", "permission denied for table accounts", "permission-denied"],
    [503, "40001", "could not serialize access", "transient"],
    [503, "08006", "connection failure", "transient"],
    [406, "PGRST116", "JSON object requested, multiple (or no) rows returned", "not-found"],
    [400, "23514", "new row violates check constraint", "unexpected"],
    [409, "23505", "duplicate key value", "unexpected"],
  ] as const;
  for (const [status, code, message, expected] of cases) {
    const body = JSON.stringify({ code, message, details: null, hint: null });
    const error = await selectError(respond(status, body));
    assert.equal(error.code, code);
    assert.equal(classifyDbError(error), expected, code);
  }
});

// --- auth-js, through getClaims ---------------------------------------------

// HS256 has no JWKS, so getClaims verifies by calling getUser -- one fetch.
function hs256Jwt(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "user-1", exp })}.c2ln`;
}

test("getClaims, auth server unreachable: network-unreachable", async () => {
  const result = await clientWith(unreachable("ECONNREFUSED")).auth.getClaims(hs256Jwt());
  assert.ok(result.error);
  assert.equal(classifyDbError(result.error), "network-unreachable");
});

test("getClaims, token rejected: auth-expired", async () => {
  const body = JSON.stringify({ code: "bad_jwt", msg: "invalid JWT" });
  const result = await clientWith(respond(401, body)).auth.getClaims(hs256Jwt());
  assert.ok(result.error);
  assert.equal(classifyDbError(result.error), "auth-expired");
});

// --- What the user sees -----------------------------------------------------

test("sessionUserId: a session yields the userid", async () => {
  const user = JSON.stringify({ id: "user-1", aud: "authenticated" });
  const result = await clientWith(respond(200, user)).auth.getClaims(hs256Jwt());
  assert.deepEqual(sessionUserId(result, "account"), { userid: "user-1", error: null });
});

test("sessionUserId: no session at all is an expired session", async (t) => {
  quiet(t);
  const result = await clientWith(unreachable("ECONNREFUSED")).auth.getClaims();
  assert.equal(result.error, null); // no session: nothing to fetch
  const session = sessionUserId(result, "account");
  assert.equal(session.userid, null);
  assert.match(session.error ?? "", /session's expired/);
});

test("sessionUserId: an unreachable auth server is NOT an expired session", async (t) => {
  quiet(t);
  const result = await clientWith(unreachable("ECONNREFUSED")).auth.getClaims(hs256Jwt());
  const session = sessionUserId(result, "account");
  assert.equal(session.userid, null);
  assert.match(session.error ?? "", /can't reach our servers/);
});

test("describe functions: an outage says so, without blaming the user's connection", async (t) => {
  quiet(t);
  const error = await selectError(unreachable("ENOTFOUND"));
  for (const message of [describeReadError(error, "accounts"), describeWriteError(error, "account")]) {
    assert.match(message, /can't reach our servers/);
    assert.doesNotMatch(message, /connection/i);
  }
});

test("describeWriteError: a duplicate keeps its own message", (t) => {
  quiet(t);
  const message = describeWriteError({ code: "23505", message: "dup" }, "account");
  assert.match(message, /already have an account with that name/);
});

test("describeReadError: a missing GRANT says it's ours, not a connection problem", (t) => {
  quiet(t);
  const message = describeReadError({ code: "42501", message: "permission denied for table accounts" }, "accounts");
  assert.match(message, /on our end/);
  assert.doesNotMatch(message, /connection|permission|accounts table/i);
  assert.notEqual(message, describeReadError({ code: "", message: "x", details: "Caused by: TypeError: fetch failed" }, "accounts"));
});

test("describeWriteError: a settings save that fails isn't called a failed load", (t) => {
  quiet(t);
  for (const code of ["42501", "PGRST116", "40001"]) {
    assert.doesNotMatch(describeWriteError({ code, message: "x" }, "settings"), /load|That settings/);
  }
});

test("mustReachUserUnchanged: only the session and outage lines", async (t) => {
  quiet(t);
  const outage = describeWriteError(await selectError(unreachable("ECONNREFUSED")), "settings");
  assert.ok(mustReachUserUnchanged(outage));
  assert.ok(mustReachUserUnchanged(describeWriteError({ code: "PGRST301", message: "JWT expired" }, "settings")));
  assert.ok(!mustReachUserUnchanged(describeWriteError({ code: "42501", message: "x" }, "settings")));
});
