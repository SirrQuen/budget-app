import { test } from "node:test";
import assert from "node:assert/strict";
import { rememberSignupEmail, SIGNUP_EMAIL_KEY, takeSignupEmail } from "./signupEmailHandoff";

function memoryStore() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

test("the remembered address is taken once", () => {
  const store = memoryStore();
  rememberSignupEmail("new.user@example.com", store);
  assert.equal(takeSignupEmail(store), "new.user@example.com");
  assert.equal(store.items.has(SIGNUP_EMAIL_KEY), false);
  assert.equal(takeSignupEmail(store), null, "a second visit to /login starts blank");
});

test("nothing remembered: null", () => {
  assert.equal(takeSignupEmail(memoryStore()), null);
});

test("unavailable or throwing storage never throws", () => {
  assert.doesNotThrow(() => rememberSignupEmail("a@example.com", throwing));
  assert.equal(takeSignupEmail(throwing), null);
  assert.doesNotThrow(() => rememberSignupEmail("a@example.com", null));
  assert.equal(takeSignupEmail(null), null);
});
