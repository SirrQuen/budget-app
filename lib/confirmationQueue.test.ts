import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysISO } from "./date";
import { projectSafeToSpend, type ProjectionSchedule } from "./safeToSpendProjection";
import { nextOccurrenceISO } from "./recurringCadence";
import {
  buildConfirmationQueue,
  confirmEach,
  confirmationCountLabel,
  confirmationKey,
} from "./confirmationQueue";

const TODAY = "2026-10-15";
const day = (n: number) => addDaysISO(TODAY, n);
const NO_HOLIDAYS: ReadonlySet<string> = new Set();

function schedule(overrides: Partial<ProjectionSchedule> & Pick<ProjectionSchedule, "kind" | "amount">): ProjectionSchedule {
  const next = overrides.nextDueDate ?? overrides.nextRunDate ?? day(1);
  return {
    recurringId: overrides.name ?? overrides.kind,
    name: overrides.kind,
    accountId: "checking",
    fromAccountType: "Checking",
    toAccountId: null,
    toAccountType: null,
    statementDay: null,
    cardPayment: null,
    amountLow: null,
    isEstimate: false,
    nextRunDate: next,
    nextDueDate: next,
    anchorDate: next,
    frequency: "Monthly",
    intervalCount: 1,
    businessDayOffset: 0,
    nonBusinessDayRule: "none",
    dateToleranceDays: 0,
    endDate: null,
    occurrencesRemaining: null,
    ...overrides,
  };
}

const queue = (schedules: ProjectionSchedule[], today = TODAY, later?: ReadonlySet<string>) =>
  buildConfirmationQueue(schedules, today, NO_HOLIDAYS, later);

function project(schedules: ProjectionSchedule[], cash: number, today = TODAY) {
  return projectSafeToSpend({
    today,
    cash,
    cushion: 100,
    schedules,
    holidays: NO_HOLIDAYS,
    fallbackWindowEnd: "2026-11-30",
  });
}

// What confirmOccurrence does to the schedule: one cycle on. (The
// transaction it writes moves cash, which the tests apply by hand.)
function advanced(s: ProjectionSchedule): ProjectionSchedule {
  const next = nextOccurrenceISO(s.nextRunDate, s.frequency, s.intervalCount, s.anchorDate);
  return { ...s, nextRunDate: next, nextDueDate: next };
}

// --- Timing -----------------------------------------------------------

test("a fixed-date schedule enters the queue on its expected date, not before", () => {
  const rent = schedule({ kind: "Expense", name: "Rent", amount: 1850, nextDueDate: day(0) });
  assert.equal(queue([rent], day(-1)).length, 0);
  assert.equal(queue([rent], day(0)).length, 1);
});

test("an approximate schedule enters the queue on its early edge (expected date minus tolerance)", () => {
  const statement = schedule({
    kind: "Transfer",
    name: "Card payment",
    amount: 412,
    toAccountId: "card",
    toAccountType: "Credit Card",
    nextDueDate: day(3),
    dateToleranceDays: 3,
  });
  assert.equal(queue([statement], day(-1)).length, 0);
  const [item] = queue([statement], day(0));
  assert.equal(item.dueDate, day(3));
  assert.equal(item.approximate, true);
});

test("an unanswered item stays in the queue indefinitely", () => {
  const rent = schedule({ kind: "Expense", name: "Rent", amount: 1850, nextDueDate: day(-60), frequency: "Yearly" });
  assert.equal(queue([rent]).length, 1);
});

test("every type queues -- income, expense, transfer -- one item per schedule", () => {
  const items = queue([
    schedule({ kind: "Income", name: "Paycheck", amount: 2000, nextDueDate: day(0) }),
    schedule({ kind: "Expense", name: "Rent", amount: 1850, nextDueDate: day(0) }),
    schedule({ kind: "Transfer", name: "To savings", amount: 300, toAccountId: "savings", toAccountType: "Savings", nextDueDate: day(0) }),
  ]);
  assert.deepEqual(items.map((i) => i.kind).sort(), ["Expense", "Income", "Transfer"]);
  assert.equal(confirmationCountLabel(items.length), "3 to confirm");
});

test("several missed cycles are one item that says how many are open", () => {
  const sub = schedule({ kind: "Expense", name: "Netflix", amount: 22.99, nextDueDate: day(-62), anchorDate: day(-62) });
  const [item] = queue([sub]);
  assert.equal(item.dueDate, day(-62));
  assert.equal(item.outstanding, 3);
});

// --- Ruling 1: income leaves the projection, never the queue ----------

test("income past its late edge leaves the projection but stays confirmable", () => {
  const pay = schedule({ kind: "Income", name: "Paycheck", amount: 2000, nextDueDate: day(-5), dateToleranceDays: 2 });
  const p = project([pay], 500);
  assert.equal(p.incomes.some((i) => i.dueDate === day(-5)), false);
  assert.equal(p.unconfirmedIncome[0]?.dueDate, day(-5));
  const [item] = queue([pay]);
  assert.equal(item.recurringId, pay.recurringId);
  assert.equal(item.dueDate, day(-5));
});

// --- "Hasn't landed yet" ------------------------------------------------

test("'hasn't landed yet' hides the item today and leaves the projection identical", () => {
  const rent = schedule({ kind: "Expense", name: "Rent", amount: 1850, nextDueDate: day(-1) });
  const before = project([rent], 3000);
  const later = new Set([confirmationKey(rent.recurringId, rent.nextDueDate)]);

  assert.equal(queue([rent], TODAY, later).length, 0);
  // Nothing was written, so the projection's inputs are the same rows --
  // and the projection has no way to read the answer at all.
  assert.deepEqual(project([rent], 3000), before);
  // Tomorrow it asks again: the cookie is keyed on the day it was given.
  assert.equal(queue([rent], day(1)).length, 1);
});

// --- The boundary: no write, no jump ----------------------------------

test("a date passing with no interaction creates nothing and leaves safe-to-spend unchanged", () => {
  const rent = schedule({ kind: "Expense", name: "Rent", amount: 1850, nextDueDate: day(1) });
  const dayBefore = project([rent], 3000, day(0));
  const dayAfter = project([rent], 3000, day(2));
  // Still counted -- clamped to today -- so the figure doesn't move.
  assert.equal(dayAfter.safeToSpend, dayBefore.safeToSpend);
  assert.equal(dayAfter.obligations[0].dueDate, day(1));
  assert.equal(dayAfter.overdueObligations[0].recurringId, rent.recurringId);
});

test("the hero figure does not change when an occurrence is confirmed (counted exactly once)", () => {
  const rent = schedule({ kind: "Expense", name: "Rent", amount: 1850, nextDueDate: day(-1) });
  const pay = schedule({ kind: "Income", name: "Paycheck", amount: 2400, nextDueDate: day(10) });
  const cash = 3000;

  const before = project([rent, pay], cash);
  // Confirm Rent as expected: the transaction leaves Checking, the schedule
  // advances a cycle.
  const after = project([advanced(rent), pay], cash - 1850);

  assert.equal(after.safeToSpend, before.safeToSpend);
});

// Income is the one asymmetry, and it's the projection's, not the queue's:
// a day's low is taken BEFORE that day's income lands, so on payday the
// pre-pay balance can be the trough until the paycheck is confirmed; and a
// paycheck past its late edge isn't counted at all (ruling 1). Either way,
// confirming it raises the figure. It can never fall -- a fall would mean
// double counting.
test("confirming income can only raise the figure, never lower it", () => {
  const rent = schedule({ kind: "Expense", name: "Rent", amount: 1850, nextDueDate: day(3) });
  for (const [cash, due] of [[500, 0], [3000, 0], [500, -1]] as const) {
    const pay = schedule({ kind: "Income", name: "Paycheck", amount: 2400, nextDueDate: day(due), dateToleranceDays: 1 });
    const before = project([pay, rent], cash);
    const after = project([advanced(pay), rent], cash + 2400);
    assert.ok(after.safeToSpend >= before.safeToSpend, `cash ${cash}, due ${due}`);
  }
});

// --- Bulk ---------------------------------------------------------------

test("bulk confirm of 4 items answers exactly 4, each once", async () => {
  const items = queue([
    schedule({ kind: "Expense", name: "Rent", amount: 1850, nextDueDate: day(0) }),
    schedule({ kind: "Expense", name: "Car payment", amount: 412, nextDueDate: day(-1) }),
    schedule({ kind: "Expense", name: "Netflix", amount: 22.99, nextDueDate: day(-2) }),
    schedule({ kind: "Transfer", name: "Transfer to Savings", amount: 300, toAccountId: "savings", toAccountType: "Savings", nextDueDate: day(0) }),
  ]);
  assert.equal(items.length, 4);

  const calls: string[] = [];
  const result = await confirmEach(items, async (i) => {
    calls.push(i.key);
    return { data: "answered" as const, error: null };
  });

  assert.equal(result.confirmed, 4);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(calls, items.map((i) => i.key));
});

test("bulk confirm reports a failure and still confirms the rest; already-answered counts as neither", async () => {
  const result = await confirmEach(["a", "b", "c", "d"], async (k) =>
    k === "b"
      ? { data: null, error: "Rent already has a transaction on that date." }
      : k === "c"
        ? { data: "already_answered" as const, error: null }
        : { data: "answered" as const, error: null },
  );
  assert.equal(result.confirmed, 2);
  assert.deepEqual(result.errors, ["Rent already has a transaction on that date."]);
});
