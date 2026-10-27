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

test("a click dismisses and none of it reaches the page; the next click acts", () => {
  const { fire, reached, dismissed } = setup();
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    assert.equal(fire(type), true, `${type} is consumed`);
  }
  assert.equal(dismissed(), 1);
  assert.deepEqual(reached, []);

  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) fire(type);
  assert.deepEqual(reached, ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
  assert.equal(dismissed(), 1);
});

test("a key dismisses and its keyup is swallowed too; the next key acts", () => {
  const { fire, reached, dismissed } = setup();
  assert.equal(fire("keydown"), true);
  assert.equal(fire("keyup"), true);
  assert.equal(dismissed(), 1);
  assert.deepEqual(reached, []);

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
