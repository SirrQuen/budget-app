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
