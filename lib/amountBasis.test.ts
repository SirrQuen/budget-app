import { test } from "node:test";
import assert from "node:assert/strict";
import { AMOUNT_BASES, amountBasisLabel, parseAmountBasis } from "./amountBasis";

test("the spec's three examples read as written", () => {
  assert.equal(amountBasisLabel("fixed"), "fixed");
  assert.equal(amountBasisLabel("highest_of_3"), "highest of last 3");
  assert.equal(amountBasisLabel("schedule"), "your estimate");
});

test("every basis has a distinct label", () => {
  const labels = AMOUNT_BASES.map(amountBasisLabel);
  assert.equal(new Set(labels).size, labels.length);
});

test("parse accepts every basis and null, and refuses anything else", () => {
  for (const b of AMOUNT_BASES) assert.equal(parseAmountBasis(b), b);
  assert.equal(parseAmountBasis(null), null);
  assert.throws(() => parseAmountBasis("median_of_5"));
});
