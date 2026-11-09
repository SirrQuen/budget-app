import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDismissed, serializeDismissed } from "./comingUpDismissedValue";

const KEY_FRI = "5f0c1f9e-2b1a-4c3d-8e9f-0a1b2c3d4e5f:2026-11-14";
const KEY_PAST = "5f0c1f9e-2b1a-4c3d-8e9f-0a1b2c3d4e5f:2026-11-01";

test("keeps dismissals still ahead, drops ones whose day has passed", () => {
  const value = serializeDismissed([KEY_FRI, KEY_PAST]);
  assert.deepEqual(parseDismissed(value, "2026-11-09"), [KEY_FRI]);
  // On the due day itself the key still parses, but the queue applies it
  // only to the coming-up state, which has ended by then.
  assert.deepEqual(parseDismissed(value, "2026-11-14"), [KEY_FRI]);
  assert.deepEqual(parseDismissed(value, "2026-11-15"), []);
});

test("ignores anything that isn't a key", () => {
  assert.deepEqual(parseDismissed("junk~<script>~", "2026-11-09"), []);
  assert.deepEqual(parseDismissed(undefined, "2026-11-09"), []);
});
