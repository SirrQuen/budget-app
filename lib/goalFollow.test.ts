import { test } from "node:test";
import assert from "node:assert/strict";
import { followedNote, historySentence } from "./goalFollow";

test("linking names the payments that stay as history", () => {
  assert.equal(
    historySentence(4, 900, "Visa"),
    "Your 4 payments ($900.00) stay in its history. From now on the goal follows Visa's balance.",
  );
  assert.equal(
    historySentence(1, 50, "Visa"),
    "Your 1 payment ($50.00) stays in its history. From now on the goal follows Visa's balance.",
  );
});

test("with no history it only says what happens next", () => {
  assert.equal(historySentence(0, 0, "Loan"), "From now on the goal follows Loan's balance.");
});

test("the Goal field's note for a followed goal", () => {
  assert.equal(followedNote("Visa Payoff"), "Visa Payoff follows the card's balance, so payments count automatically.");
});

test("no copy here comments on direction or uses alarm words", () => {
  const all = [historySentence(4, 900, "Visa"), historySentence(0, 0, "Visa"), followedNote("Visa Payoff")].join(" ");
  assert.doesNotMatch(all, /behind|lost|!/i);
});
