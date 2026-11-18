import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_ENDED_HREF,
  SESSION_ENDED_NOTICE,
  isServerActionRequest,
  sessionEndedActionResponse,
} from "./sessionEnded";
import { signedOutHref, timeoutNotice } from "./idleTimeout";

test("a Server Action call is a POST carrying next-action", () => {
  assert.equal(isServerActionRequest("POST", new Headers({ "next-action": "abc" })), true);
  assert.equal(isServerActionRequest("POST", new Headers()), false);
  assert.equal(isServerActionRequest("GET", new Headers({ "next-action": "abc" })), false);
});

test("the action response: no body, a replace redirect to the neutral landing", async () => {
  const res = sessionEndedActionResponse();
  assert.equal(res.headers.get("x-action-redirect"), `${SESSION_ENDED_HREF};replace`);
  assert.equal(res.headers.get("location"), null);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(await res.text(), "");
});

test("the expired landing names no cause; the idle landing keeps its own", () => {
  assert.equal(SESSION_ENDED_HREF, "/login?reason=expired");
  assert.notEqual(SESSION_ENDED_HREF, signedOutHref("timeout"));
  assert.doesNotMatch(SESSION_ENDED_NOTICE, /inactiv|minute|timed? ?out|!|error|wrong/i);
  assert.match(timeoutNotice(), /inactivity/);
});
