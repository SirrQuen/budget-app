import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProjectedObligation } from "./safeToSpendProjection";
import { itemHref, lowestPointLabel, onChosenDay, runwayCalculation, whatIfView } from "./runway";
import type { WhatIfAnswer } from "./whatIf";

const TODAY = "2026-11-17"; // a Tuesday

function bill(name: string, amount: number, date = "2026-11-20"): ProjectedObligation {
  return { recurringId: name, transactionId: null, name, amount, date, dueDate: date, isEstimate: false, basis: "fixed" };
}

const daily = [{ date: TODAY, low: 0, end: 0, out: [], income: [] }];

test("lowestPointLabel: day · figure · your lowest point, after its items (largest first)", () => {
  assert.equal(
    lowestPointLabel({ daily, trough: { amount: 2800, date: "2026-11-20", obligations: [bill("Gym", 40), bill("Rent", 1850)] } }),
    "Friday 20 November · $2,800 · your lowest point, after Rent and Gym",
  );
  assert.equal(
    lowestPointLabel({
      daily,
      trough: { amount: 10.5, date: "2026-11-20", obligations: [bill("A", 3), bill("B", 2), bill("C", 1)] },
    }),
    "Friday 20 November · $10.50 · your lowest point, after A, B and 1 more",
  );
});

test("lowestPointLabel: today, with nothing coming out, has no 'after'", () => {
  assert.equal(
    lowestPointLabel({ daily, trough: { amount: 1200, date: TODAY, obligations: [] } }),
    "Today · $1,200 · your lowest point",
  );
});

test("lowestPointLabel: below zero reads as the breakdown does, never red words", () => {
  assert.equal(
    lowestPointLabel({ daily, trough: { amount: -200, date: "2026-11-20", obligations: [bill("Rent", 1850)] } }),
    "Friday 20 November · −$200 · your lowest point, after Rent",
  );
});

test("runwayCalculation: the ruling's line, goal money included when there is some", () => {
  assert.equal(
    runwayCalculation({
      trough: { amount: 2800, date: TODAY, obligations: [] },
      cushion: 300,
      goalHold: 150,
      safeToSpend: 2350,
      signedSafeToSpend: 2350,
    }),
    "$2,800 lowest point − $300 cushion − $150 for goals = $2,350 safe to spend.",
  );
  assert.equal(
    runwayCalculation({
      trough: { amount: 2800, date: TODAY, obligations: [] },
      cushion: 300,
      goalHold: 0,
      safeToSpend: 2500,
      signedSafeToSpend: 2500,
    }),
    "$2,800 lowest point − $300 cushion = $2,500 safe to spend.",
  );
});

test("runwayCalculation: the $0 floor, in neutral words", () => {
  assert.equal(
    runwayCalculation({
      trough: { amount: 2800, date: TODAY, obligations: [] },
      cushion: 3000,
      goalHold: 0,
      safeToSpend: 0,
      signedSafeToSpend: -200,
    }),
    "$2,800 lowest point − $3,000 cushion comes to less than $0, so safe to spend is $0.",
  );
  // Exactly zero isn't floored: it's the sum.
  assert.equal(
    runwayCalculation({
      trough: { amount: 300, date: TODAY, obligations: [] },
      cushion: 300,
      goalHold: 0,
      safeToSpend: 0,
      signedSafeToSpend: 0,
    }),
    "$300 lowest point − $300 cushion = $0 safe to spend.",
  );
});

test("itemHref: a schedule opens on the recurring page; a one-off opens itself", () => {
  assert.equal(itemHref({ recurringId: "r1", transactionId: null }), "/recurring#schedule-r1");
  assert.equal(itemHref({ recurringId: null, transactionId: "t1" }), "/transactions/t1/edit");
});

test("onChosenDay: today, a weekday inside the week, a date beyond it", () => {
  assert.equal(onChosenDay(TODAY, TODAY), "today");
  assert.equal(onChosenDay("2026-11-21", TODAY), "on Saturday");
  assert.equal(onChosenDay("2026-11-23", TODAY), "on Monday");
  assert.equal(onChosenDay("2026-11-24", TODAY), "on Nov 24");
});

function answer(overrides: Partial<Extract<WhatIfAnswer, { kind: "answer" }>> = {}): WhatIfAnswer {
  return {
    kind: "answer",
    horizonEnd: "2026-12-22",
    before: { safeToSpend: 2500, troughDate: "2026-11-20" },
    after: { safeToSpend: 1600, signedSafeToSpend: 1600, troughDate: "2026-11-20", troughItems: ["Rent"] },
    fits: true,
    earliestFit: null,
    ...overrides,
  };
}

test("whatIfView: fits, tightest day unchanged", () => {
  assert.deepEqual(whatIfView(answer(), 90000, "2026-11-21", TODAY), {
    kind: "figure",
    safeToSpend: 1600,
    line: "With $900 on Saturday, safe to spend would be $1,600.",
    tightest: "Your tightest day stays Friday 20 November.",
  });
});

test("whatIfView: fits, tightest day moves -- names the pretend as 'this'", () => {
  const view = whatIfView(
    answer({ after: { safeToSpend: 900, signedSafeToSpend: 900, troughDate: "2026-11-21", troughItems: ["This"] } }),
    90000,
    "2026-11-21",
    TODAY,
  );
  assert.equal(view.kind === "figure" && view.tightest, "Your tightest day would move to Saturday 21 November, after this.");
});

test("whatIfView: doesn't fit yet -- the ruling's wording, with the day it would", () => {
  const view = whatIfView(
    answer({
      fits: false,
      earliestFit: "2026-11-27",
      after: { safeToSpend: 0, signedSafeToSpend: -50, troughDate: "2026-11-20", troughItems: ["Rent"] },
    }),
    90000,
    "2026-11-21",
    TODAY,
  );
  assert.deepEqual(view, {
    kind: "figure",
    safeToSpend: 0,
    line: "$900 on Saturday doesn't fit yet. From Nov 27, there's room.",
    tightest: null,
  });
});

test("whatIfView: nothing in the horizon fits -- names the real horizon end", () => {
  const view = whatIfView(
    answer({ fits: false, earliestFit: null, after: { safeToSpend: 0, signedSafeToSpend: -5000, troughDate: TODAY, troughItems: [] } }),
    900000,
    TODAY,
    TODAY,
  );
  assert.equal(
    view.line,
    "$9,000 today doesn't fit yet. It doesn't fit before Dec 22, the furthest Sorrel can see.",
  );
});

test("whatIfView: beyond the horizon and before today", () => {
  assert.deepEqual(whatIfView({ kind: "beyond", horizonEnd: "2026-12-22" }, 100, "2027-01-05", TODAY), {
    kind: "message",
    line: "Sorrel can see as far as Dec 22. Pick a day on or before it.",
  });
  assert.equal(whatIfView({ kind: "past", today: TODAY }, 100, "2026-11-01", TODAY).line, "Pick today or a day ahead.");
});

test("whatIf and runway copy never judge", () => {
  const lines = [
    whatIfView(answer(), 90000, "2026-11-21", TODAY),
    whatIfView(answer({ fits: false, earliestFit: null }), 90000, "2026-11-21", TODAY),
  ].flatMap((v) => [v.line, v.kind === "figure" ? v.tightest ?? "" : ""]);
  for (const line of lines) {
    assert.doesNotMatch(line, /can't afford|cannot afford|behind|over budget|missed|!/i, line);
  }
});
