import { test } from "node:test";
import assert from "node:assert/strict";
import { consumeFirstInput } from "./consumeFirstInput";

// Two levels, as in the browser: `win` is window in the capture phase, which
// sees every event first; the page only gets an event that wasn't stopped
// there. (Node's EventTarget has no propagation path of its own.)
function setup() {
  const win = new EventTarget();
  const page = new EventTarget();
  let dismissed = 0;
  const cleanup = consumeFirstInput(win, () => dismissed++);
  const reached: string[] = [];
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "keydown", "keyup", "wheel"]) {
    page.addEventListener(type, () => reached.push(type));
  }
  const fire = (type: string) => {
    const event = new Event(type, { cancelable: true });
    win.dispatchEvent(event);
    if (!event.cancelBubble) page.dispatchEvent(new Event(type, { cancelable: true }));
    return event.defaultPrevented;
  };
  return { fire, reached, cleanup, dismissed: () => dismissed };
}

// A second gesture is always a later task than the first.
const nextTask = () => new Promise((r) => setTimeout(r, 0));

test("a click dismisses and none of it reaches the page; the next click acts", async () => {
  const { fire, reached, dismissed } = setup();
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    assert.equal(fire(type), true, `${type} is consumed`);
  }
  assert.equal(dismissed(), 1);
  assert.deepEqual(reached, []);

  await nextTask();
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) fire(type);
  assert.deepEqual(reached, ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
  assert.equal(dismissed(), 1);
});

test("a key dismisses and its keyup is swallowed too; the next key acts", async () => {
  const { fire, reached, dismissed } = setup();
  assert.equal(fire("keydown"), true);
  assert.equal(fire("keyup"), true);
  assert.equal(dismissed(), 1);
  assert.deepEqual(reached, []);

  await nextTask();
  fire("keydown");
  assert.deepEqual(reached, ["keydown"]);
});

test("cleanup before any input stops listening; nothing is consumed", () => {
  const { fire, reached, cleanup, dismissed } = setup();
  cleanup();
  assert.equal(fire("click"), false);
  assert.equal(fire("pointerdown"), false);
  assert.equal(dismissed(), 0);
  assert.deepEqual(reached, ["click", "pointerdown"]);
});

test("cleanup after the dismissing pointerdown still swallows the rest of the click", () => {
  // The overlay unmounts on dismiss, which runs its cleanup mid-gesture.
  const { fire, reached, cleanup } = setup();
  fire("pointerdown");
  cleanup();
  for (const type of ["mousedown", "pointerup", "mouseup", "click"]) fire(type);
  assert.deepEqual(reached, []);
});

test("a quick second click acts even when the first gesture got no click event", async () => {
  // The overlay unmounts on pointerdown, so Chrome never dispatches the
  // first gesture's click. The swallow must end on release, not wait for it.
  const { fire, reached } = setup();
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) fire(type);
  await nextTask();
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) fire(type);
  assert.deepEqual(reached, ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
});
