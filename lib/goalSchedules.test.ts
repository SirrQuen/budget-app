import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alsoFedByHint,
  cadenceWord,
  deleteGoalSchedulesLine,
  duplicateOf,
  duplicateQuestion,
  moveLine,
  onlyThisPaymentLine,
  scheduleLabel,
  uncountedOffer,
  type ScheduleFacts,
} from "./goalSchedules";
import { freedUpLine } from "./goalCompletion";

const weekly50: ScheduleFacts = {
  id: "w",
  description: "Weekly $50",
  amount: 50,
  basis: "fixed",
  frequency: "Weekly",
  intervalCount: 1,
  accountId: "checking",
  toAccountId: "savings",
  toAccountName: "Savings",
};
const monthly200: ScheduleFacts = { ...weekly50, id: "m", description: "Rent day", amount: 200, frequency: "Monthly" };

test("cadence words: no monthly figure is ever made from a frequency, only named", () => {
  assert.equal(cadenceWord("Weekly"), "Weekly");
  assert.equal(cadenceWord("Weekly", 2), "Every 2 weeks");
  assert.equal(cadenceWord("Biweekly"), "Every 2 weeks");
  assert.equal(cadenceWord("Monthly"), "Monthly");
  assert.equal(cadenceWord("Yearly"), "Yearly");
});

test("a schedule is named by what it does, its amount carrying its basis", () => {
  assert.equal(scheduleLabel(weekly50), "Weekly $50 (fixed) to Savings");
  assert.equal(scheduleLabel({ ...weekly50, amount: 50.5 }), "Weekly $50.50 (fixed) to Savings");
});

test("also fed by: information when the goal has other schedules, nothing when it has none", () => {
  assert.equal(alsoFedByHint("Emergency fund", []), null);
  assert.equal(alsoFedByHint("Emergency fund", [weekly50]), "Emergency fund is also fed by Weekly $50 (fixed) to Savings.");
  assert.equal(
    alsoFedByHint("Emergency fund", [weekly50, monthly200]),
    "Emergency fund is also fed by Weekly $50 (fixed) to Savings and Monthly $200 (fixed) to Savings.",
  );
});

test("a move is said on the schedule", () => {
  assert.equal(moveLine("Beach trip", "Emergency fund"), "This schedule will feed Beach trip instead of Emergency fund.");
});

test("duplicate: same amount, frequency, interval and accounts -- to the cent, and never itself", () => {
  const candidate = { amount: 50, frequency: "Weekly", intervalCount: 1, accountId: "checking", toAccountId: "savings" };
  assert.equal(duplicateOf(candidate, [monthly200, weekly50])?.id, "w");
  assert.equal(duplicateOf({ ...candidate, amount: 50.01 }, [weekly50]), undefined);
  assert.equal(duplicateOf({ ...candidate, intervalCount: 2 }, [weekly50]), undefined);
  assert.equal(duplicateOf({ ...candidate, toAccountId: "brokerage" }, [weekly50]), undefined);
  assert.equal(duplicateOf({ ...candidate, id: "w" }, [weekly50]), undefined);
  assert.equal(duplicateQuestion(weekly50), "Weekly $50 (fixed) to Savings already feeds this goal. Add this one as well?");
});

test("one occurrence, another goal: only this payment", () => {
  assert.equal(
    onlyThisPaymentLine("Weekly $50", "Emergency fund"),
    "Only this payment. Weekly $50 still feeds Emergency fund.",
  );
});

test("earlier confirmations are offered, one or many", () => {
  assert.equal(uncountedOffer(1, "Weekly $50"), "1 earlier transfer from Weekly $50 isn't counted toward this goal. Count it?");
  assert.equal(uncountedOffer(3, "Weekly $50"), "3 earlier transfers from Weekly $50 aren't counted toward this goal. Count them?");
});

test("the goal delete confirmation names its schedules", () => {
  assert.equal(deleteGoalSchedulesLine(0), null);
  assert.equal(deleteGoalSchedulesLine(1), "1 schedule feeds this goal. It'll keep running, unlinked.");
  assert.equal(deleteGoalSchedulesLine(2), "2 schedules feed this goal. They'll keep running, unlinked.");
});

test("completion: the freed-up line names each schedule's own amount", () => {
  assert.equal(freedUpLine([]), null);
  assert.equal(
    freedUpLine([scheduleLabel(weekly50)]),
    "Weekly $50 (fixed) to Savings isn't committed to anything now.",
  );
  assert.equal(
    freedUpLine([scheduleLabel(weekly50), scheduleLabel(monthly200)]),
    "Weekly $50 (fixed) to Savings and Monthly $200 (fixed) to Savings aren't committed to anything now.",
  );
});
