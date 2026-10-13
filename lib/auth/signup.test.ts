import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createAccount, type SignupConnection } from "./signup";
import { INVITE_CODE_ERROR, INVITE_UNAVAILABLE_ERROR } from "./inviteCode";

// Drives createAccount() -- the signup server action's body -- with a fake
// Supabase auth client, so "signUp was never called" is observed, not assumed.

const CODE = "Spring-Sorrel-42";

function form(inviteCode: string): FormData {
  const data = new FormData();
  data.set("inviteCode", inviteCode);
  data.set("email", "new.user@example.com");
  data.set("firstName", "Robin");
  data.set("password", "Correct-horse-9");
  data.set("confirmPassword", "Correct-horse-9");
  return data;
}

function fakeConnection(t: TestContext) {
  const signUp = t.mock.fn(async () => ({ data: { user: null, session: null }, error: null }));
  const connect = t.mock.fn(async () => ({ auth: { signUp }, origin: "http://app.test" }));
  return { connect: connect as unknown as SignupConnection, signUp, connected: connect };
}

function withCode(t: TestContext, value: string | undefined) {
  const before = process.env.SORREL_INVITE_CODE;
  if (value === undefined) delete process.env.SORREL_INVITE_CODE;
  else process.env.SORREL_INVITE_CODE = value;
  t.after(() => {
    if (before === undefined) delete process.env.SORREL_INVITE_CODE;
    else process.env.SORREL_INVITE_CODE = before;
  });
}

test("correct invite code: signup proceeds", async (t) => {
  withCode(t, CODE);
  const { connect, signUp } = fakeConnection(t);
  const result = await createAccount(form(CODE), connect);
  assert.equal(signUp.mock.callCount(), 1);
  assert.match(result?.success ?? "", /Check your email/);
});

test("wrong invite code: rejected on the field, signUp never called", async (t) => {
  withCode(t, CODE);
  const { connect, signUp, connected } = fakeConnection(t);
  for (const code of ["Spring-Sorrel-43", "", "   ", "Spring-Sorrel-4", "SpringSorrel42"]) {
    const result = await createAccount(form(code), connect);
    assert.deepEqual(result, { field: "inviteCode", error: INVITE_CODE_ERROR }, JSON.stringify(code));
  }
  assert.equal(signUp.mock.callCount(), 0);
  assert.equal(connected.mock.callCount(), 0, "a Supabase client was created");
});

test("wrong invite code is reported before any other field", async (t) => {
  withCode(t, CODE);
  const { connect, signUp } = fakeConnection(t);
  const data = form("nope");
  data.set("email", "");
  const result = await createAccount(data, connect);
  assert.equal(result?.field, "inviteCode");
  assert.equal(signUp.mock.callCount(), 0);
});

test("correct code in another case with surrounding whitespace: accepted", async (t) => {
  withCode(t, CODE);
  const { connect, signUp } = fakeConnection(t);
  for (const code of ["  spring-sorrel-42 ", "SPRING-SORREL-42", "\tSpRiNg-SoRrEl-42\n"]) {
    const result = await createAccount(form(code), connect);
    assert.ok(result?.success, JSON.stringify(code));
  }
  assert.equal(signUp.mock.callCount(), 3);
});

test("env var unset or blank: every signup rejected, loudly", async (t) => {
  const error = t.mock.method(console, "error", () => {});
  for (const configured of [undefined, "", "   "]) {
    withCode(t, configured);
    const { connect, signUp, connected } = fakeConnection(t);
    for (const code of ["", CODE, "anything"]) {
      const result = await createAccount(form(code), connect);
      assert.deepEqual(result, { field: undefined, error: INVITE_UNAVAILABLE_ERROR });
    }
    assert.equal(signUp.mock.callCount(), 0);
    assert.equal(connected.mock.callCount(), 0);
  }
  assert.ok(error.mock.calls.some((c) => String(c.arguments[0]).includes("SORREL_INVITE_CODE")));
});
