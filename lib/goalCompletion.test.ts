import { test } from "node:test";
import assert from "node:assert/strict";
import { aheadOfDate, completionCopy, duration, type GoalCompletionFacts } from "./goalCompletion";

const base: GoalCompletionFacts = {
  goalId: "g",
  goalName: "New laptop",
  goalType: "Custom",
  contributed: 1400,
  targetAmount: 1400,
  targetDate: null,
  firstContributionDate: "2026-06-27",
  completedOn: "2026-10-27",
};

test("savings: the user's own name, the figure, one detail", () => {
  const copy = completionCopy(base);
  assert.equal(copy.headline, "New laptop — done.");
  assert.equal(copy.figure, "$1,400.00 set aside over four months.");
  assert.equal(copy.next, "start-another");
});

test("savings ahead of its date names how far ahead instead", () => {
  const copy = completionCopy({ ...base, targetDate: "2026-12-15" });
  assert.equal(copy.figure, "$1,400.00 set aside — seven weeks ahead of your date.");
});

test("debt payoff: paid off, cleared since the first month", () => {
  const copy = completionCopy({
    ...base,
    goalName: "Visa",
    goalType: "Debt Payoff",
    contributed: 4280,
    targetAmount: 4280,
    firstContributionDate: "2026-03-02",
    targetDate: "2026-12-15",
  });
  assert.equal(copy.headline, "Visa is paid off.");
  assert.equal(copy.figure, "$4,280.00 cleared since March — seven weeks ahead of your date.");
  // No schedule can be tied to the goal with confidence: the line is dropped.
  assert.equal(copy.nextLine, null);
});

test("debt payoff from a previous year names the year", () => {
  const copy = completionCopy({ ...base, goalType: "Debt Payoff", firstContributionDate: "2025-11-02" });
  assert.match(copy.figure, /since November 2025/);
});

test("retirement is a milestone: nothing says the work is finished", () => {
  const copy = completionCopy({
    ...base,
    goalName: "Retirement",
    goalType: "Retirement",
    contributed: 50000,
    targetAmount: 50000,
    firstContributionDate: "2025-11-27",
  });
  assert.equal(copy.headline, "Retirement: you’ve reached $50,000.00.");
  assert.equal(copy.figure, "$50,000.00 saved, eleven months in.");
  assert.equal(copy.next, "set-next");
  for (const text of [copy.headline, copy.figure, copy.nextLine ?? ""]) {
    assert.doesNotMatch(text, /done|finished|complete|paid off/i);
  }
});

test("no copy carries an exclamation mark", () => {
  for (const goalType of ["Custom", "Debt Payoff", "Retirement", "Vacation"]) {
    const copy = completionCopy({ ...base, goalType });
    assert.doesNotMatch(`${copy.headline} ${copy.figure} ${copy.nextLine ?? ""}`, /!/);
  }
});

test("completed the same day it started: the figure stands alone", () => {
  const copy = completionCopy({ ...base, firstContributionDate: "2026-10-27" });
  assert.equal(copy.figure, "$1,400.00 set aside.");
});

test("duration and ahead-of-date wording", () => {
  assert.equal(duration(1), null);
  assert.equal(duration(9), "nine days");
  assert.equal(duration(49), "seven weeks");
  assert.equal(duration(400), "13 months");
  assert.equal(duration(800), "two years");
  assert.equal(aheadOfDate("2026-10-27", "2026-10-28"), "one day ahead of your date");
  assert.equal(aheadOfDate("2026-10-27", "2026-10-27"), null);
  assert.equal(aheadOfDate("2026-10-27", "2026-10-01"), null);
});
