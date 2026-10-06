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

test("two missed weekly occurrences share today's date but keep distinct due dates", () => {
  // Both clamp to today, so (recurringId, date) can't identify a row --
  // the dashboard keys obligation rows by (recurringId, dueDate) instead.
  const gym = schedule({ kind: "Expense", name: "Gym", amount: 20, frequency: "Weekly", nextDueDate: day(-10) });
  const result = run([paycheck, gym], 2000, 0);

  const today = result.obligations.filter((o) => o.name === "Gym" && o.date === TODAY);
  assert.deepEqual(
    today.map((o) => o.dueDate),
    [day(-10), day(-3)],
  );
});

test("nothing overdue -> both attention lists empty", () => {
  const result = run([paycheck, rent]);
  assert.deepEqual(result.unconfirmedIncome, []);
  assert.deepEqual(result.overdueObligations, []);
});

// Income projects across the whole horizon, exactly like obligations do.
// Confirmation gates writing a transaction, never the forecast (CLAUDE.md
// "Money rules -- invariants").

test("semi-monthly income (1st + 15th) over a 35-day horizon -> 3 income events, not 1", () => {
  // No semi-monthly cadence exists; it's two Monthly schedules.
  const first = schedule({ kind: "Income", name: "Pay 1st", amount: 1000, nextDueDate: TODAY });
  const fifteenth = schedule({ kind: "Income", name: "Pay 15th", amount: 1000, nextDueDate: "2026-10-15" });
  const result = run([first, fifteenth]);

  assert.equal(result.horizonEnd, day(35));
  assert.deepEqual(
    result.incomes.map((i) => [i.name, i.date]),
    [
      ["Pay 1st", "2026-10-01"],
      ["Pay 15th", "2026-10-15"],
      ["Pay 1st", "2026-11-01"],
    ],
  );
});

test("weekly income over a 35-day horizon -> 5 income events", () => {
  const weekly = schedule({ kind: "Income", name: "Weekly pay", amount: 400, frequency: "Weekly", nextDueDate: day(7) });
  const result = run([weekly]);

  assert.equal(result.horizonEnd, day(35));
  assert.deepEqual(
    result.incomes.map((i) => i.date),
    [day(7), day(14), day(21), day(28), day(35)],
  );
});

test("monthly income, horizon extended to the payday after next -> 2 income events", () => {
  const monthly = schedule({ kind: "Income", name: "Paycheck", amount: 3000, nextDueDate: day(5) });
  const result = run([monthly]);

  assert.equal(result.horizonReason, "payday_after_next");
  assert.equal(result.horizonEnd, "2026-11-06");
  assert.deepEqual(
    result.incomes.map((i) => i.date),
    [day(5), "2026-11-06"],
  );
});

test("unconfirmed variable income -> every occurrence at the LOW amount and the LATE date", () => {
  const variable = schedule({
    kind: "Income",
    name: "Paycheck",
    amount: 1500,
    amountLow: 1200,
    isEstimate: true,
    frequency: "Weekly",
    intervalCount: 2,
    dateToleranceDays: 2,
    nextDueDate: day(3),
  });
  const result = run([variable]);

  // Due days 3, 17, 31 -> counted on their late edges 5, 19, 33.
  assert.deepEqual(
    result.incomes.map((i) => [i.date, i.amount, i.isEstimate]),
    [
      [day(5), 1200, true],
      [day(19), 1200, true],
      [day(33), 1200, true],
    ],
  );
});

test("a confirmed paycheck uses its confirmed values, not the estimate", () => {
  // Income has no "confirmed but not yet posted" state: confirming writes
  // the transaction at the confirmed amount (so it's in cash) and advances
  // the schedule one cycle. The confirmed $1,650 must count exactly once --
  // in cash -- not again at the $1,200 low estimate, and the rest of the
  // schedule keeps projecting.
  const confirmedAmount = 1650;
  const afterConfirming = schedule({
    kind: "Income",
    name: "Paycheck",
    amount: 1500,
    amountLow: 1200,
    isEstimate: true,
    frequency: "Weekly",
    intervalCount: 2,
    nextDueDate: day(14),
  });
  const result = run([afterConfirming], 500 + confirmedAmount, 0);

  assert.equal(result.cashOnHand, 2150);
  assert.ok(!result.incomes.some((i) => i.date === TODAY));
  assert.deepEqual(
    result.incomes.map((i) => [i.date, i.amount]),
    [
      [day(14), 1200],
      [day(28), 1200],
    ],
  );
});

test("regression guard: with recurring income the trough does not land on the horizon's last day", () => {
  // Pay covers bills week to week, so the low point is the first bill.
  // If income stopped after one payday while bills continued, the balance
  // would fall all the way to the end and the trough would sit on the
  // final day -- the signature of income being dropped from the forecast.
  const weeklyPay = schedule({ kind: "Income", name: "Pay", amount: 500, frequency: "Weekly", nextDueDate: day(7) });
  const weeklyBill = schedule({ kind: "Expense", name: "Bill", amount: 450, frequency: "Weekly", nextDueDate: day(6) });
  const finalDayBill = schedule({ kind: "Expense", name: "Gym", amount: 40, nextDueDate: day(35), occurrencesRemaining: 1 });
  const result = run([weeklyPay, weeklyBill, finalDayBill], 1000, 0);

  assert.equal(result.horizonEnd, day(35));
  assert.equal(result.incomes.length, 5);
  assert.notEqual(result.trough.date, result.horizonEnd);
  assert.equal(result.trough.date, day(6));
  assert.equal(result.trough.amount, 550);
});

// A variable card payment's first occurrence pays what's owed today; each
// later one pays only its own statement cycle's charges. Today's balance
// is never paid twice.

const CARD = "card-1";
const netflix = schedule({
  kind: "Expense",
  name: "Netflix",
  amount: 20,
  fromAccountType: "Credit Card",
  accountId: CARD,
  nextDueDate: "2026-10-12",
});

function cardPayment(overrides: Partial<ProjectionSchedule>): ProjectionSchedule {
  return schedule({
    kind: "Transfer",
    name: "Card payment",
    amount: 900,
    isEstimate: true,
    toAccountType: "Credit Card",
    toAccountId: CARD,
    statementDay: 28,
    nextDueDate: "2026-10-22",
    cardPayment: { amountConfirmed: false, balanceOwed: 900 },
    ...overrides,
  });
}

// Long horizon so two payments land inside it: monthly pay on day 5 makes
// the payday after next 2026-11-06; a second, later paycheck pushes it on.
const latePay = schedule({ kind: "Income", name: "Pay", amount: 5000, nextDueDate: "2026-10-25" });

test("unconfirmed card payment: the balance is paid once, the next payment is the next cycle's charges", () => {
  const result = run([latePay, cardPayment({}), netflix], 5000, 0);

  // Statement 09-28 -> due 10-22 pays the $900 owed. Statement 10-28 ->
  // due 11-22 pays the Netflix charge from 10-12 (the cycle 09-28..10-28).
  assert.equal(result.horizonEnd, "2026-11-25");
  assert.deepEqual(
    result.obligations.filter((o) => o.name === "Card payment").map((o) => [o.date, o.amount, o.isEstimate]),
    [
      ["2026-10-22", 900, true],
      ["2026-11-22", 20, true],
    ],
  );
  // Netflix itself is charged to the card -- only the payment moves cash.
  assert.ok(!result.obligations.some((o) => o.name === "Netflix"));
});

test("confirmed card payment: confirmed amount first, then what's posted since the statement plus new charges", () => {
  // Statement says $700; the card owes $900 today, so $200 posted after
  // the statement closed -- that belongs to the next payment.
  const confirmed = cardPayment({
    amount: 700,
    isEstimate: false,
    cardPayment: { amountConfirmed: true, balanceOwed: 900 },
  });
  const result = run([latePay, confirmed, netflix], 5000, 0);

  assert.deepEqual(
    result.obligations.filter((o) => o.name === "Card payment").map((o) => [o.date, o.amount, o.isEstimate]),
    [
      ["2026-10-22", 700, false],
      ["2026-11-22", 220, true],
    ],
  );
});

test("unconfirmed card payment with its statement still ahead: charges before the statement join the first payment", () => {
  // Due 10-22 with statement day 15 -> statement 10-15, after today, so the
  // 10-12 Netflix charge lands on THIS statement, not the next.
  const result = run([latePay, cardPayment({ statementDay: 15 }), netflix], 5000, 0);

  assert.deepEqual(
    result.obligations.filter((o) => o.name === "Card payment").map((o) => [o.date, o.amount]),
    [
      ["2026-10-22", 920],
      ["2026-11-22", 20],
    ],
  );
});

// Edges of the walk: the horizon boundary, same-day ordering, the cushion
// floor, and variable income's pessimistic edges.

test("obligation falling exactly on the horizon boundary -> included, not dropped", () => {
  // Weekly pay from day 3: paydays 3, 10 -> payday after next is day 10, so
  // the horizon is the 35-day minimum. The bill is due on day 35 itself.
  const weekly = schedule({ kind: "Income", name: "Weekly pay", amount: 400, frequency: "Weekly", nextDueDate: day(3) });
  const boundaryBill = schedule({
    kind: "Expense",
    name: "Insurance",
    amount: 2500,
    nextDueDate: day(35),
    occurrencesRemaining: 1,
  });
  const result = run([weekly, boundaryBill], 1000, 0);

  assert.equal(result.horizonEnd, day(35));
  assert.deepEqual(
    result.obligations.map((o) => [o.name, o.date, o.amount]),
    [["Insurance", day(35), 2500]],
  );
  // 1000 + 5 x 400 (days 3..31) = 3000, then -2500 on day 35.
  assert.equal(result.trough.amount, 500);
  assert.equal(result.trough.date, day(35));
  assert.equal(result.safeToSpend, 500);
});

test("income and an obligation on the same day -> the obligation is applied first", () => {
  // A paycheck that posts in the afternoon doesn't cover a payment that
  // cleared that morning. Income-first would read 1000 -> 2500 -> 1300 and
  // never dip; obligation-first reads 1000 -> -200 -> 1300.
  const sameDayBill = schedule({
    kind: "Expense",
    name: "Car payment",
    amount: 1200,
    nextDueDate: day(5),
    occurrencesRemaining: 1,
  });
  const result = run([paycheck, sameDayBill], 1000, 0);

  assert.equal(result.trough.amount, -200);
  assert.equal(result.trough.date, day(5));
  assert.deepEqual(result.shortfall, { amount: 200, date: day(5) });
  assert.equal(result.safeToSpend, 0);
  const payday = result.daily.find((d) => d.date === day(5));
  assert.deepEqual(payday, { date: day(5), low: -200, end: 1300 });
});

test("cushion larger than the trough -> hero is $0, never negative", () => {
  // Trough is $1,700 (the worked case); a $2,500 cushion would put it at -$800.
  const result = run([paycheck, rent], 2000, 2500);

  assert.equal(result.trough.amount, 1700);
  assert.equal(result.cushion, 2500);
  assert.equal(result.safeToSpend, 0);
  assert.ok(!Object.is(result.safeToSpend, -0));
  assert.equal(result.perDay, null);
  // The trough itself never goes below zero, so this isn't a shortfall.
  assert.equal(result.shortfall, null);
});

test("variable-amount income -> the LOW end of the estimate and the LATE end of the date tolerance", () => {
  // Expected $1,500 (low $1,200), due day 5 +/- 3 days. A bill on day 7 sits
  // between the due date and the late edge. At the low amount and late date:
  // 500 -> -800 (day 7) -> 400 (day 8). At the expected amount on the due
  // date it would be 500 -> 2000 (day 5) -> 700 (day 7), never short.
  const variable = schedule({
    kind: "Income",
    name: "Paycheck",
    amount: 1500,
    amountLow: 1200,
    isEstimate: true,
    dateToleranceDays: 3,
    nextDueDate: day(5),
  });
  const bill = schedule({ kind: "Expense", name: "Bill", amount: 1300, nextDueDate: day(7), occurrencesRemaining: 1 });
  const result = run([variable, bill], 500, 0);

  // Due days 5 and 36 (Oct 6, Nov 6) -> counted on days 8 and 39; the
  // horizon runs to the second payday's late edge.
  assert.equal(result.horizonEnd, day(39));
  assert.deepEqual(
    result.incomes.map((i) => [i.dueDate, i.date, i.amount, i.isEstimate]),
    [
      [day(5), day(8), 1200, true],
      [day(36), day(39), 1200, true],
    ],
  );
  assert.equal(result.trough.amount, -800);
  assert.equal(result.trough.date, day(7));
  assert.deepEqual(result.shortfall, { amount: 800, date: day(7) });
  assert.equal(result.safeToSpend, 0);
});
