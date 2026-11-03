import { test } from "node:test";
import assert from "node:assert/strict";
import { transferEffect, transferEffectLine } from "./transferEdit";

test("the effect follows the spendable set (Checking + Cash)", () => {
  assert.equal(transferEffect("Checking", "Savings"), "out");
  assert.equal(transferEffect("Savings", "Checking"), "in");
  assert.equal(transferEffect("Checking", "Cash"), "none");
  assert.equal(transferEffect("Savings", "Investment"), "none");
});

test("swapping direction flips out and in", () => {
  assert.equal(transferEffect("Checking", "Savings"), "out");
  assert.equal(transferEffect("Savings", "Checking"), "in");
});

test("a line only when the edit changes the effect", () => {
  assert.equal(transferEffectLine("out", "out", "Checking", "Savings"), null);
  assert.equal(
    transferEffectLine("none", "out", "Checking", "Savings"),
    "Safe to spend will count this as money leaving Checking.",
  );
  assert.equal(
    transferEffectLine("out", "in", "Savings", "Checking"),
    "Safe to spend will count this as money arriving in Checking.",
  );
  assert.equal(
    transferEffectLine("out", "none", "Checking", "Cash"),
    "Safe to spend won't count this: Checking and Cash are on the same side.",
  );
});
