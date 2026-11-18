import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { updateSession } from "./middleware";

// Drives the real proxy with a stubbed fetch. The case that matters: when
// the auth server can't be reached, the request must neither pass through
// (an unverified session is not "authenticated") nor redirect to /login
// (our outage is not the user signing out).

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";

// @supabase/ssr's cookie: sb-<first host label>-auth-token, base64url JSON.
const COOKIE = "sb-supabase-auth-token";

// HS256 has no JWKS, so getClaims verifies it by calling getUser: one fetch.
function sessionCookie(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "user-1", exp: expiresAt })}.c2ln`;
  const session = {
    access_token: jwt,
    refresh_token: "refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    user: { id: "user-1", aud: "authenticated" },
  };
  return "base64-" + b64(session);
}

function request(pathname: string, signedIn: boolean) {
  const req = new NextRequest(`http://app.test${pathname}`);
  if (signedIn) req.cookies.set(COOKIE, sessionCookie());
  return req;
}

function stubFetch(t: TestContext, impl: typeof globalThis.fetch) {
  return t.mock.method(globalThis, "fetch", impl);
}

const unreachable: typeof globalThis.fetch = async () => {
  const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  throw new TypeError("fetch failed", { cause });
};

function respond(status: number, body: object): typeof globalThis.fetch {
  return async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function quiet(t: TestContext) {
  for (const level of ["error", "warn", "info"] as const) {
    t.mock.method(console, level, () => {});
  }
}

// NextResponse.next() marks pass-through with this header.
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

test("auth server unreachable: 503, never a pass-through or a redirect", async (t) => {
  quiet(t);
  const fetch = stubFetch(t, unreachable);
  for (const pathname of ["/dashboard", "/settings", "/login", "/"]) {
    const res = await updateSession(request(pathname, true));
    assert.equal(res.status, 503, pathname);
    assert.equal(res.headers.get("location"), null, `${pathname}: redirected`);
    assert.equal(passedThrough(res), false, `${pathname}: passed through`);
    assert.equal(res.headers.get("x-middleware-rewrite"), null, `${pathname}: rewritten`);
    assert.match(await res.text(), /can't reach our servers/);
  }
  assert.ok(fetch.mock.callCount() > 0, "the auth server was never asked");
});

test("token rejected by the auth server: redirect to /login", async (t) => {
  quiet(t);
  stubFetch(t, respond(401, { code: "bad_jwt", msg: "invalid JWT" }));
  const res = await updateSession(request("/dashboard", true));
  assert.equal(res.status, 307);
  assert.equal(new URL(res.headers.get("location")!).pathname, "/login");
});

test("verified session: passes through", async (t) => {
  quiet(t);
  stubFetch(t, respond(200, { id: "user-1", aud: "authenticated" }));
  const res = await updateSession(request("/dashboard", true));
  assert.equal(passedThrough(res), true);
});

test("no session cookie: redirect to /login without asking the auth server", async (t) => {
  quiet(t);
  const fetch = stubFetch(t, unreachable);
  const res = await updateSession(request("/dashboard", false));
  assert.equal(res.status, 307);
  assert.equal(new URL(res.headers.get("location")!).pathname, "/login");
  assert.equal(fetch.mock.callCount(), 0);
});

test("legal pages: readable signed out and signed in", async (t) => {
  quiet(t);
  stubFetch(t, respond(200, { id: "user-1", aud: "authenticated" }));
  for (const pathname of ["/privacy", "/terms"]) {
    for (const signedIn of [false, true]) {
      const res = await updateSession(request(pathname, signedIn));
      assert.equal(passedThrough(res), true, `${pathname}, signed ${signedIn ? "in" : "out"}`);
    }
  }
});

test("landing page: signed out sees it, signed in goes to the dashboard", async (t) => {
  quiet(t);
  stubFetch(t, respond(200, { id: "user-1", aud: "authenticated" }));
  assert.equal(passedThrough(await updateSession(request("/", false))), true);
  const res = await updateSession(request("/", true));
  assert.equal(res.status, 307);
  assert.equal(new URL(res.headers.get("location")!).pathname, "/dashboard");
});

// Queue item 22 (ruled 2026-11-18): a save whose session has gone must land
// on /login?reason=expired, never the generic error. A 307 is followed by
// the browser's fetch as a POST to /login, which Next's client can't read
// as an action response. The proxy answers a Server Action call with the
// header Next's client turns into a full page load instead.
function actionRequest(pathname: string, signedIn: boolean) {
  const req = new NextRequest(`http://app.test${pathname}`, {
    method: "POST",
    headers: { "next-action": "7f00000000000000000000000000000000000000aa", "content-type": "text/plain;charset=UTF-8" },
    body: "[]",
  });
  if (signedIn) req.cookies.set(COOKIE, sessionCookie());
  return req;
}

test("save with no session: x-action-redirect to /login?reason=expired, never a redirect", async (t) => {
  quiet(t);
  stubFetch(t, unreachable);
  for (const pathname of ["/goals", "/dashboard", "/transactions"]) {
    const res = await updateSession(actionRequest(pathname, false));
    assert.equal(res.status, 401, pathname);
    assert.equal(res.headers.get("location"), null, `${pathname}: a 3xx would be followed as POST /login`);
    assert.equal(res.headers.get("x-action-redirect"), "/login?reason=expired;replace", pathname);
    assert.equal(passedThrough(res), false, `${pathname}: passed through`);
    assert.equal(await res.text(), "", `${pathname}: body`);
  }
});

test("save whose token the auth server rejects: the same landing", async (t) => {
  quiet(t);
  stubFetch(t, respond(401, { code: "bad_jwt", msg: "invalid JWT" }));
  const res = await updateSession(actionRequest("/goals", true));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("x-action-redirect"), "/login?reason=expired;replace");
});

test("save with a verified session: passes through", async (t) => {
  quiet(t);
  stubFetch(t, respond(200, { id: "user-1", aud: "authenticated" }));
  assert.equal(passedThrough(await updateSession(actionRequest("/goals", true))), true);
});

test("save while the auth server is unreachable: still the 503, not a sign-out", async (t) => {
  quiet(t);
  stubFetch(t, unreachable);
  const res = await updateSession(actionRequest("/goals", true));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("x-action-redirect"), null);
});

test("a POST that isn't a Server Action keeps the plain redirect", async (t) => {
  quiet(t);
  stubFetch(t, unreachable);
  const req = new NextRequest("http://app.test/goals", { method: "POST", body: "x" });
  const res = await updateSession(req);
  assert.equal(res.status, 307);
  assert.equal(new URL(res.headers.get("location")!).pathname, "/login");
  assert.equal(res.headers.get("x-action-redirect"), null);
});
