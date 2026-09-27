import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysISO } from "./date";
import { projectSafeToSpend, type ProjectionSchedule } from "./safeToSpendProjection";

const TODAY = "2026-10-01";
const day = (n: number) => addDaysISO(TODAY, n);
const NO_HOLIDAYS: ReadonlySet<string> = new Set();

function schedule(overrides: Partial<ProjectionSchedule> & Pick<ProjectionSchedule, "kind" | "amount">): ProjectionSchedule {
  const next = overrides.nextDueDate ?? overrides.nextRunDate ?? day(1);
  return {
    recurringId: overrides.name ?? overrides.kind,
    name: overrides.kind,
    fromAccountType: "Checking",
    toAccountType: null,
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

const paycheck = schedule({ kind: "Income", name: "Paycheck", amount: 1500, nextDueDate: day(5) });
const rent = schedule({ kind: "Expense", name: "Rent", amount: 1800, nextDueDate: day(7) });

function run(schedules: ProjectionSchedule[], cash = 2000, cushion = 300) {
  return projectSafeToSpend({
    today: TODAY,
    cash,
    cushion,
    schedules,
    holidays: NO_HOLIDAYS,
    fallbackWindowEnd: "2026-10-31",
  });
}

test("worked case: $2,000 cash, +$1,500 in 5 days, -$1,800 in 7 days, $300 cushion -> $1,400", () => {
  const result = run([paycheck, rent]);

  assert.equal(result.mode, "projection");
  assert.equal(result.trough.amount, 1700);
  assert.equal(result.trough.date, day(7));
  assert.deepEqual(
    result.trough.obligations.map((o) => o.name),
    ["Rent"],
  );
  assert.equal(result.cushion, 300);
  assert.equal(result.safeToSpend, 1400);
  assert.equal(result.shortfall, null);
});

test("same case with no rent -> $2,000 minus cushion", () => {
  const result = run([paycheck]);

  assert.equal(result.trough.amount, 2000);
  assert.equal(result.trough.date, TODAY);
  assert.deepEqual(result.trough.obligations, []);
  assert.equal(result.safeToSpend, 1700);
});

test("obligation before payday larger than cash -> $0, with the shortfall amount and date", () => {
  // One-off, so next month's rent (day 33, inside the day-36 horizon)
  // doesn't become the deeper trough.
  const earlyRent = schedule({
    kind: "Expense",
    name: "Rent",
    amount: 1800,
    nextDueDate: day(3),
    occurrencesRemaining: 1,
  });
  const result = run([paycheck, earlyRent], 1000);

  assert.equal(result.safeToSpend, 0);
  assert.equal(result.perDay, null);
  assert.deepEqual(result.shortfall, { amount: 800, date: day(3) });
  assert.equal(result.trough.amount, -800);
  assert.deepEqual(
    result.trough.obligations.map((o) => o.name),
    ["Rent"],
  );
});

test("Checking -> Savings transfer inside the horizon -> trough unchanged", () => {
  const toSavings = schedule({
    kind: "Transfer",
    name: "Save",
    amount: 500,
    fromAccountType: "Checking",
    toAccountType: "Savings",
    nextDueDate: day(6),
  });
  const result = run([paycheck, rent, toSavings]);

  assert.equal(result.trough.amount, 1700);
  assert.equal(result.trough.date, day(7));
  assert.equal(result.safeToSpend, 1400);
  assert.ok(!result.obligations.some((o) => o.name === "Save"));
});

test("weekly income with a monthly bill on day 30 -> horizon extends to 35 days and the bill is included", () => {
  const weekly = schedule({
    kind: "Income",
    name: "Weekly pay",
    amount: 400,
    frequency: "Weekly",
    nextDueDate: day(7),
  });
  const bill = schedule({ kind: "Expense", name: "Phone", amount: 80, nextDueDate: day(30) });
  const result = run([weekly, bill]);

  // Payday after next is day 14 -- well inside the minimum.
  assert.equal(result.horizonEnd, day(35));
  assert.equal(result.horizonReason, "minimum");
  assert.deepEqual(
    result.obligations.map((o) => [o.name, o.date]),
    [["Phone", day(30)]],
  );
});

test("two income schedules -> horizon runs through the second payday after today", () => {
  // Monthly A lands day 25 (then day 56), monthly B lands day 40.
  // Paydays in order: 25 (A), 40 (B), 56 (A) -- the second is B's.
  const a = schedule({ kind: "Income", name: "A", amount: 1000, nextDueDate: day(25) });
  const b = schedule({ kind: "Income", name: "B", amount: 500, nextDueDate: day(40) });
  const result = run([a, b]);

  assert.equal(result.horizonEnd, day(40));
  assert.equal(result.horizonReason, "payday_after_next");
  assert.deepEqual(
    result.incomes.map((i) => [i.name, i.date]),
    [
      ["A", day(25)],
      ["B", day(40)],
    ],
  );
});

// Beyond the six required cases: the estimate edges and the fallback.

test("income uses the late edge of its tolerance and the low amount", () => {
  const variable = schedule({
    kind: "Income",
    name: "Paycheck",
    amount: 1500,
    amountLow: 1200,
    dateToleranceDays: 3,
    nextDueDate: day(5),
  });
  const bill = schedule({
    kind: "Expense",
    name: "Bill",
    amount: 2500,
    nextDueDate: day(7),
    occurrencesRemaining: 1,
  });
  const result = run([variable, bill], 2000, 0);

  // Paycheck counted on day 8 (after the bill), at $1,200.
  assert.equal(result.incomes[0].date, day(8));
  assert.equal(result.incomes[0].amount, 1200);
  assert.deepEqual(result.shortfall, { amount: 500, date: day(7) });
});

test("an obligation uses the early edge of its tolerance", () => {
  const bill = schedule({
    kind: "Expense",
    name: "Bill",
    amount: 2500,
    dateToleranceDays: 3,
    nextDueDate: day(7),
    occurrencesRemaining: 1,
  });
  const result = run([paycheck, bill], 2000, 0);

  // Charged on day 4, before the day-5 paycheck.
  assert.equal(result.trough.date, day(4));
  assert.equal(result.trough.amount, -500);
});

test("no usable income schedule -> window mode, cash minus commitments minus cushion", () => {
  const result = run([rent], 2000, 100);

  assert.equal(result.mode, "window");
  assert.equal(result.horizonEnd, "2026-10-31");
  assert.deepEqual(result.incomes, []);
  assert.equal(result.safeToSpend, 2000 - 1800 - 100);
});

test("income into a non-spendable account is not usable income", () => {
  const toInvestment = schedule({
    kind: "Income",
    name: "Dividend",
    amount: 900,
    fromAccountType: "Investment",
    nextDueDate: day(5),
  });
  assert.equal(run([toInvestment, rent]).mode, "window");
});

test("zero cushion is allowed", () => {
  assert.equal(run([paycheck, rent], 2000, 0).safeToSpend, 1700);
});

test("recurring rent: next month's instance becomes the low point when pay doesn't cover it", () => {
  // Rent monthly on day 3 (then day 34); pay monthly on day 5 (then day 36,
  // which is the payday after next and so the horizon).
  const monthlyRent = schedule({ kind: "Expense", name: "Rent", amount: 1800, nextDueDate: day(3) });
  const smallPay = schedule({ kind: "Income", name: "Paycheck", amount: 1000, nextDueDate: day(5) });
  const result = run([smallPay, monthlyRent], 3000, 0);

  // 3000 -> 1200 (day 3) -> 2200 (day 5) -> 400 (day 34).
  assert.equal(result.horizonEnd, day(36));
  assert.equal(result.trough.amount, 400);
  assert.equal(result.trough.date, day(34));
  assert.deepEqual(
    result.trough.obligations.map((o) => [o.name, o.date]),
    [["Rent", day(34)]],
  );
  assert.equal(result.safeToSpend, 400);
});

test("an unconfirmed paycheck past its late edge is left out of the maths and surfaced", () => {
  // Weekly pay whose day -3 occurrence was never confirmed: next_due_date
  // stays in the past until someone confirms it.
  const stale = schedule({
    kind: "Income",
    name: "Paycheck",
    amount: 800,
    frequency: "Weekly",
    dateToleranceDays: 1,
    nextDueDate: day(-3),
  });
  const result = run([stale, rent], 2000, 0);

  assert.deepEqual(result.unconfirmedIncome, [
    { recurringId: "Paycheck", name: "Paycheck", amount: 800, dueDate: day(-3), isEstimate: false },
  ]);
  // Not counted: the first income in the projection is next week's, on
  // its late edge (day 4 + 1 day of tolerance).
  assert.equal(result.incomes[0].date, day(5));
  assert.ok(!result.incomes.some((i) => i.date < TODAY));
});

test("an overdue unposted bill is subtracted today and surfaced", () => {
  const lateRent = schedule({
    kind: "Expense",
    name: "Rent",
    amount: 1800,
    nextDueDate: day(-3),
    occurrencesRemaining: 1,
  });
  const result = run([paycheck, lateRent], 2000, 0);

  assert.equal(result.trough.date, TODAY);
  assert.equal(result.trough.amount, 200);
  assert.deepEqual(result.overdueObligations, [
    { recurringId: "Rent", name: "Rent", amount: 1800, dueDate: day(-3), isEstimate: false },
  ]);
});

test("nothing overdue -> both attention lists empty", () => {
  const result = run([paycheck, rent]);
  assert.deepEqual(result.unconfirmedIncome, []);
  assert.deepEqual(result.overdueObligations, []);
});
