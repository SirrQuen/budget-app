import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceChange, initialChange, rollCells } from "./valueChange";

test("the first value is not a change", () => {
  const s = initialChange(100);
  assert.equal(s.direction, null);
  assert.equal(s.seq, 0);
});

test("the same value returns the same state, so React does not re-render", () => {
  const s = initialChange(100);
  assert.equal(advanceChange(s, 100), s);
});

test("a rise and a fall are told apart, and each counts once", () => {
  const up = advanceChange(initialChange(100), 150);
  assert.equal(up.direction, "up");
  assert.equal(up.previous, 100);
  assert.equal(up.seq, 1);
  const down = advanceChange(up, 120);
  assert.equal(down.direction, "down");
  assert.equal(down.previous, 150);
  assert.equal(down.seq, 2);
});

test("compares in cents, not floats", () => {
  const s = initialChange(0.1 + 0.2);
  assert.equal(advanceChange(s, 0.3), s);
});

test("a movement under a cent is not a change", () => {
  const s = initialChange(10);
  assert.equal(advanceChange(s, 10.004), s);
});

test("rollCells aligns from the right and marks only the places that moved", () => {
  const cells = rollCells("+$999.00", "+$1,000.00");
  assert.equal(cells.length, 10);
  assert.deepEqual(cells[0], { from: "", to: "+", changed: true });
  assert.equal(cells[cells.length - 1].changed, false);
  assert.equal(cells[cells.length - 3].changed, false);
});

test("rollCells on equal-length figures marks the changed digits", () => {
  const cells = rollCells("$1,200.00", "$1,250.00");
  assert.deepEqual(
    cells.filter((c) => c.changed),
    [{ from: "0", to: "5", changed: true }],
  );
});
