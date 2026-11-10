import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysISO } from "./date";
import { projectSafeToSpend, type ProjectionSchedule } from "./safeToSpendProjection";
import { nextOccurrenceISO } from "./recurringCadence";
import { ANCHOR_ANSWER_REQUIRED, ANCHOR_ANSWER_STALE } from "./anchorAnswer";
import {
  alreadyRecorded,
  buildConfirmationQueue,
  confirmEach,
  toConfirmItems,
  isComingUp,
  confirmQuestion,
  COMING_UP_DAYS,
  needsAnswerLabel,
  confirmationCountLabel,
  confirmationKey,
  confirmedAmountIsEstimated,
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
    amountHigh: null,
    amountBasis: "fixed",
    forecastBasis: null,
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
    goalHolds: [],
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
  // The day before, it is the same item coming up -- not yet to confirm.
  assert.deepEqual(queue([rent], day(-1)).map((i) => i.state), ["coming-up"]);
  assert.equal(toConfirmItems(queue([rent], day(-1))).length, 0);
  assert.deepEqual(queue([rent], day(0)).map((i) => i.state), ["to-confirm"]);
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
  // Tolerance 3 < 5: coming up the day before its window opens.
  assert.deepEqual(queue([statement], day(-1)).map((i) => i.state), ["coming-up"]);
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
  assert.equal(result.needsAnswer, 0);
  assert.deepEqual(result.errors, ["Rent already has a transaction on that date."]);
});

// Confirm all must say what it skipped (migration 62): an item dated before
// a balance date needs the "already included?" answer, which one tap can't
// give. It's counted apart from failures and the rest still go through.
test("bulk confirm counts items needing the pre-anchor answer apart from errors", async () => {
  const result = await confirmEach(["a", "b", "c", "d"], async (k) =>
    k === "a" || k === "c"
      ? { data: null, error: k === "a" ? ANCHOR_ANSWER_REQUIRED : ANCHOR_ANSWER_STALE }
      : { data: "answered" as const, error: null },
  );
  assert.equal(result.confirmed, 2);
  assert.equal(result.needsAnswer, 2);
  assert.deepEqual(result.errors, []);
  assert.equal(needsAnswerLabel(2), "2 items need an answer");
  assert.equal(needsAnswerLabel(1), "1 item needs an answer");
});

// PaymentNote's switch: a transfer paying money owed to a third party (a
// card, a loan), and nothing else -- not a move between the user's own
// accounts, not an expense charged to the card.
test("payee marks transfers into a card or loan only", () => {
  const items = queue([
    schedule({ recurringId: "card", kind: "Transfer", amount: 300, toAccountId: "visa", toAccountType: "Credit Card", nextDueDate: TODAY }),
    schedule({ recurringId: "loan", kind: "Transfer", amount: 250, toAccountId: "car", toAccountType: "Loan", nextDueDate: TODAY }),
    schedule({ recurringId: "savings", kind: "Transfer", amount: 100, toAccountId: "sav", toAccountType: "Savings", nextDueDate: TODAY }),
    schedule({ recurringId: "rent", kind: "Expense", amount: 1400, nextDueDate: TODAY }),
  ]);
  const marked = Object.fromEntries(items.map((i) => [i.recurringId, i.payee]));
  assert.deepEqual(marked, { card: "card", loan: "loan", savings: null, rent: null });
});

// is_estimated: TRUE when the amount was never supplied by a person.

test("one-tap on a variable schedule is estimated; on a fixed one it isn't", () => {
  assert.equal(confirmedAmountIsEstimated(true, 151), true);
  assert.equal(confirmedAmountIsEstimated(false, 1850), false);
});

test("'It was different' with the amount changed is the person's figure", () => {
  assert.equal(confirmedAmountIsEstimated(true, 151, 163.4), false);
});

test("'It was different' saved with the pre-filled amount untouched stays estimated", () => {
  assert.equal(confirmedAmountIsEstimated(true, 151, 151), true);
  // Compared in cents, so a float round-trip doesn't read as a change.
  assert.equal(confirmedAmountIsEstimated(true, 0.1 + 0.2, 0.3), true);
});

test("a statement amount (not an estimate) stays a person's figure either way", () => {
  assert.equal(confirmedAmountIsEstimated(false, 700, 700), false);
});

test("a queue item shows what its own amount rests on", () => {
  const electric = schedule({
    kind: "Expense",
    name: "Electric",
    amount: 151,
    amountHigh: 190,
    amountBasis: "average_of_3",
    forecastBasis: "highest_of_3",
    nextDueDate: day(0),
  });
  const [item] = queue([electric]);
  assert.equal(item.amount, 151);
  assert.equal(item.basis, "average_of_3");
});

// The narrow duplicate net: only rows already carrying this schedule's
// recurringid, only inside this occurrence's window.
test("alreadyRecorded: a linked row on a fixed occurrence's own day", () => {
  assert.deepEqual(alreadyRecorded("2026-11-01", 0, [{ date: "2026-11-01", amount: 10 }]), {
    date: "2026-11-01",
    amount: 10,
  });
});

test("alreadyRecorded: a fixed date's window is the day itself", () => {
  assert.equal(alreadyRecorded("2026-11-01", 0, [{ date: "2026-10-31", amount: 10 }]), null);
  assert.equal(alreadyRecorded("2026-11-01", 0, [{ date: "2026-10-01", amount: 10 }]), null);
});

test("alreadyRecorded: an approximate date's window is give or take its tolerance", () => {
  const linked = [{ date: "2026-10-28", amount: 50 }];
  assert.notEqual(alreadyRecorded("2026-10-30", 2, linked), null);
  assert.equal(alreadyRecorded("2026-10-31", 2, linked), null);
  assert.notEqual(alreadyRecorded("2026-10-26", 2, linked), null);
  assert.equal(alreadyRecorded("2026-10-25", 2, linked), null);
});

test("alreadyRecorded: the closest to the due date wins", () => {
  const linked = [
    { date: "2026-10-27", amount: 1 },
    { date: "2026-10-31", amount: 2 },
    { date: "2026-10-28", amount: 3 },
  ];
  assert.equal(alreadyRecorded("2026-10-30", 3, linked)?.amount, 2);
});

test("alreadyRecorded: on a tie, the earlier one", () => {
  const linked = [
    { date: "2026-10-31", amount: 2 },
    { date: "2026-10-29", amount: 3 },
  ];
  assert.equal(alreadyRecorded("2026-10-30", 3, linked)?.amount, 3);
});

test("the queue carries each schedule's tolerance for the window", () => {
  const items = buildConfirmationQueue([schedule({ kind: "Expense", amount: 20, nextDueDate: TODAY, dateToleranceDays: 3 })], TODAY, NO_HOLIDAYS);
  assert.equal(items[0].dateToleranceDays, 3);
});

// ---------------------------------------------------------------------
// Coming up: the same item, five days ahead (docs/Budgets-Reminders-and-
// Pending.md, item 1)
// ---------------------------------------------------------------------

test("a schedule due in 5 days is coming up, and on the day it's to confirm -- the same item", () => {
  const rent = schedule({ recurringId: "rent", kind: "Expense", name: "Rent", amount: 1850, nextDueDate: day(0) });
  assert.equal(COMING_UP_DAYS, 5);
  assert.deepEqual(queue([rent], day(-6)), []);
  const monday = queue([rent], day(-5));
  const friday = queue([rent], day(0));
  assert.deepEqual(monday.map((i) => i.state), ["coming-up"]);
  assert.deepEqual(friday.map((i) => i.state), ["to-confirm"]);
  // Same occurrence, same key: what was seen Monday is what's confirmed Friday.
  assert.equal(monday[0].key, friday[0].key);
  assert.equal(monday[0].dueDate, friday[0].dueDate);
});

// When the confirm window opens early, it is the reminder.
test("coming up runs only until the confirm window opens", () => {
  // Tolerance 2: window opens day(-2), so coming up is day(-5)..day(-3).
  assert.equal(isComingUp(day(0), 2, day(-5)), true);
  assert.equal(isComingUp(day(0), 2, day(-3)), true);
  assert.equal(isComingUp(day(0), 2, day(-2)), false);
});

test("with a tolerance of 5 or more there is no coming-up span at all", () => {
  for (const tolerance of [5, 7]) {
    for (let n = -10; n <= 0; n += 1) {
      assert.equal(isComingUp(day(0), tolerance, day(n)), false, `tolerance ${tolerance}, day ${n}`);
    }
  }
  const paycheck = schedule({ kind: "Income", name: "Paycheck", amount: 2400, nextDueDate: day(7), dateToleranceDays: 7 });
  // Its window opens day(0) (due day 7, tolerance 7): nothing before, to confirm from then.
  assert.deepEqual(queue([paycheck], day(-1)), []);
  assert.deepEqual(queue([paycheck], day(0)).map((i) => i.state), ["to-confirm"]);
});

test("dismissing hides only the coming-up state; the day it opens, it asks", () => {
  const rent = schedule({ recurringId: "rent", kind: "Expense", name: "Rent", amount: 1850, nextDueDate: day(0) });
  const key = confirmationKey("rent", day(0));
  const dismissed = new Set([key]);
  assert.deepEqual(buildConfirmationQueue([rent], day(-3), NO_HOLIDAYS, new Set(), dismissed), []);
  assert.deepEqual(
    buildConfirmationQueue([rent], day(0), NO_HOLIDAYS, new Set(), dismissed).map((i) => i.state),
    ["to-confirm"],
  );
});

test("coming-up items are never counted or confirmed in bulk, and sort after to-confirm", () => {
  const rent = schedule({ recurringId: "rent", kind: "Expense", name: "Rent", amount: 1850, nextDueDate: day(3) });
  const netflix = schedule({ recurringId: "nf", kind: "Expense", name: "Netflix", amount: 22.99, nextDueDate: day(-1) });
  const items = queue([rent, netflix]);
  assert.deepEqual(items.map((i) => [i.name, i.state]), [["Netflix", "to-confirm"], ["Rent", "coming-up"]]);
  assert.deepEqual(toConfirmItems(items).map((i) => i.name), ["Netflix"]);
});

test("the to-confirm question is plain -- never overdue, never due soon", () => {
  assert.equal(confirmQuestion({ name: "Rent", kind: "Expense" }), "Did Rent come out?");
  assert.equal(confirmQuestion({ name: "Paycheck", kind: "Income" }), "Did Paycheck land?");
  assert.equal(confirmQuestion({ name: "Transfer to Savings", kind: "Transfer" }), "Did Transfer to Savings go through?");
});
