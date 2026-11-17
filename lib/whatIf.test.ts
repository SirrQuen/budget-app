import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysISO } from "./date";
import { projectSafeToSpend, type ProjectionSchedule, type SafeToSpendProjectionInput } from "./safeToSpendProjection";
import { assembleSafeToSpend, type SafeToSpendInputs } from "./safeToSpendInputs";
import {
  WHAT_IF_ID,
  answerWhatIf,
  earliestFitting,
  parseAmountToCents,
  parseWhatIfRequest,
  whatIfTransaction,
  withWhatIf,
} from "./whatIf";

const TODAY = "2026-10-01";
const day = (n: number) => addDaysISO(TODAY, n);

function schedule(overrides: Partial<ProjectionSchedule> & Pick<ProjectionSchedule, "kind" | "amount">): ProjectionSchedule {
  const next = overrides.nextDueDate ?? day(1);
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

// $2,000 cash; +$1,500 on day 5 (then monthly); -$1,800 rent on day 7.
// Trough $1,700 on day 7; $300 cushion -> $1,400 safe to spend.
const paycheck = schedule({ kind: "Income", name: "Paycheck", amount: 1500, nextDueDate: day(5) });
const rent = schedule({ kind: "Expense", name: "Rent", amount: 1800, nextDueDate: day(7) });

function input(overrides: Partial<SafeToSpendProjectionInput> = {}): SafeToSpendProjectionInput {
  return {
    today: TODAY,
    cash: 2000,
    cushion: 300,
    goalHolds: [],
    schedules: [paycheck, rent],
    futureTransactions: [],
    holidays: new Set(),
    fallbackWindowEnd: "2026-10-31",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The split: the hero is exactly one projection of the inputs.
// ---------------------------------------------------------------------------

function inputs(projection = input()): SafeToSpendInputs {
  return {
    projection,
    context: {
      fallbackReason: "end_of_month",
      cushionIsDefault: false,
      nextIncome: null,
      paycheck: "none",
      drawnFrom: [{ id: "a", name: "Checking", balance: 2000 }],
      notCounted: [],
    },
  };
}

test("assembleSafeToSpend: the projection of its inputs, plus the context read with them", () => {
  const hero = assembleSafeToSpend(inputs());
  const direct = projectSafeToSpend(input());
  for (const key of Object.keys(direct) as (keyof typeof direct)[]) {
    assert.deepEqual(hero[key], direct[key], key);
  }
  assert.equal(hero.safeToSpend, 1400);
  assert.equal(hero.cushionIsDefault, false);
  assert.deepEqual(hero.drawnFrom, [{ id: "a", name: "Checking", balance: 2000 }]);
  assert.equal("fallbackReason" in hero, false);
});

test("assembleSafeToSpend: windowReason only in window mode", () => {
  assert.equal(assembleSafeToSpend(inputs()).windowReason, null);
  const noPay = assembleSafeToSpend(inputs(input({ schedules: [rent] })));
  assert.equal(noPay.mode, "window");
  assert.equal(noPay.windowReason, "end_of_month");
});

// ---------------------------------------------------------------------------
// The pretend expense
// ---------------------------------------------------------------------------

test("parseAmountToCents: integer cents from the digits, never a float", () => {
  assert.equal(parseAmountToCents("12"), 1200);
  assert.equal(parseAmountToCents("12.5"), 1250);
  assert.equal(parseAmountToCents("0.29"), 29);
  assert.equal(parseAmountToCents("$1,250.75"), 125075);
  assert.equal(parseAmountToCents("  900. "), 90000);
  assert.equal(parseAmountToCents("0"), 0);
  assert.equal(parseAmountToCents(""), null);
  assert.equal(parseAmountToCents("-5"), null);
  assert.equal(parseAmountToCents("1.234"), null);
  assert.equal(parseAmountToCents("abc"), null);
  assert.equal(parseAmountToCents("1e5"), null);
  assert.equal(parseAmountToCents("10000000000.00"), null);
});

test("whatIfTransaction: a one-off expense leaving the spendable set, sentinel id", () => {
  const t = whatIfTransaction(90000, day(3));
  assert.equal(t.transactionId, WHAT_IF_ID);
  assert.equal(t.kind, "Expense");
  assert.equal(t.amount, 900);
  assert.equal(t.fromCountsLater, true);
  const p = projectSafeToSpend(withWhatIf(input(), 29, day(3)));
  assert.equal(p.obligations.find((o) => o.transactionId === WHAT_IF_ID)?.amount, 0.29);
});

test("withWhatIf: $0 adds nothing; the inputs are never mutated", () => {
  const base = input();
  assert.equal(withWhatIf(base, 0, day(3)), base);
  const added = withWhatIf(base, 100, day(3));
  assert.equal(base.futureTransactions.length, 0);
  assert.equal(added.futureTransactions.length, 1);
});

test("what-if of $0 returns exactly the hero's figure", () => {
  const hero = assembleSafeToSpend(inputs());
  const a = answerWhatIf(input(), 0, TODAY);
  assert.equal(a.kind, "answer");
  if (a.kind !== "answer") return;
  assert.equal(a.after.safeToSpend, hero.safeToSpend);
  assert.equal(a.before.safeToSpend, hero.safeToSpend);
  assert.equal(a.after.troughDate, hero.trough.date);
  assert.equal(a.fits, true);
  assert.equal(a.earliestFit, null);
});

test("a what-if that fits: the figure drops by the amount when dated before the tightest day", () => {
  const a = answerWhatIf(input(), 40000, day(2));
  assert.equal(a.kind, "answer");
  if (a.kind !== "answer") return;
  assert.equal(a.after.safeToSpend, 1000);
  assert.equal(a.fits, true);
  assert.equal(a.earliestFit, null);
  assert.equal(a.after.troughDate, day(7));
  assert.deepEqual(a.after.troughItems, ["Rent"]);
});

test("a what-if can move the tightest day, and names itself there", () => {
  // Dated after the tightest day (day 7, $1,700), $500 on day 8 makes a
  // new low of $1,200 there. (Dated before it, it would lower both alike.)
  const a = answerWhatIf(input(), 50000, day(8));
  if (a.kind !== "answer") return assert.fail(a.kind);
  assert.equal(a.before.troughDate, day(7));
  assert.equal(a.after.troughDate, day(8));
  assert.deepEqual(a.after.troughItems, ["This"]);
  assert.equal(a.after.safeToSpend, 900);
});

test("doesn't fit: the earliest later day it would, and the day before it doesn't", () => {
  // $1,000 cash, no cushion; +$1,500 on day 5; -$800 on day 20.
  // $1,200 on day 2 takes today's 1,000 to -200. On day 5 the bill leaves
  // before the paycheck lands, so still -200. From day 6 the paycheck is
  // in: 2,500 - 1,200 = 1,300, then 500 after day 20 -- it fits.
  const lateRent = schedule({ kind: "Expense", name: "Rent", amount: 800, nextDueDate: day(20) });
  const inp = input({ cash: 1000, cushion: 0, schedules: [paycheck, lateRent] });
  const a = answerWhatIf(inp, 120000, day(2));
  if (a.kind !== "answer") return assert.fail(a.kind);
  assert.equal(a.fits, false);
  assert.equal(a.after.safeToSpend, 0);
  assert.equal(a.after.signedSafeToSpend, -200);
  assert.equal(a.earliestFit, day(6));
  const fitsOn = (d: string) => projectSafeToSpend(withWhatIf(inp, 120000, d)).signedSafeToSpend >= 0;
  assert.equal(fitsOn(a.earliestFit!), true);
  assert.equal(fitsOn(addDaysISO(a.earliestFit!, -1)), false);
});

test("nothing in the horizon fits: earliestFit is null", () => {
  const a = answerWhatIf(input(), 1_000_000, day(1));
  if (a.kind !== "answer") return assert.fail(a.kind);
  assert.equal(a.fits, false);
  assert.equal(a.earliestFit, null);
});

test("beyond the horizon: no projection answer, names the horizon end", () => {
  const horizonEnd = projectSafeToSpend(input()).horizonEnd;
  assert.deepEqual(answerWhatIf(input(), 100, addDaysISO(horizonEnd, 1)), { kind: "beyond", horizonEnd });
  // The last day itself is answered.
  assert.equal(answerWhatIf(input(), 100, horizonEnd).kind, "answer");
});

test("before today: refused", () => {
  assert.deepEqual(answerWhatIf(input(), 100, day(-1)), { kind: "past", today: TODAY });
});

// ---------------------------------------------------------------------------
// The binary search
// ---------------------------------------------------------------------------

const dates = Array.from({ length: 60 }, (_, i) => day(i + 1));

test("earliestFitting: first true of a monotone predicate, every position", () => {
  for (let k = 0; k <= dates.length; k++) {
    const expected = k < dates.length ? dates[k] : null;
    assert.equal(
      earliestFitting(dates, (d) => d >= (dates[k] ?? "9999-12-31")),
      expected,
      `boundary at ${k}`,
    );
  }
});

test("earliestFitting: logarithmic -- at most ceil(log2(n + 1)) checks", () => {
  for (const k of [0, 1, 17, 30, 59, 60]) {
    let calls = 0;
    earliestFitting(dates, (d) => {
      calls++;
      return d >= (dates[k] ?? "9999-12-31");
    });
    assert.ok(calls <= Math.ceil(Math.log2(dates.length + 1)), `${calls} calls at ${k}`);
  }
  assert.equal(earliestFitting([], () => true), null);
});

test("earliestFitting matches a linear scan over real projections", () => {
  const inp = input({ cash: 1800 });
  for (const cents of [10000, 50000, 120000, 160000, 400000]) {
    const from = day(1);
    const days = Array.from({ length: 40 }, (_, i) => day(i + 2)).filter(
      (d) => d <= projectSafeToSpend(inp).horizonEnd,
    );
    const fitsOn = (d: string) => projectSafeToSpend(withWhatIf(inp, cents, d)).signedSafeToSpend >= 0;
    const linear = days.find(fitsOn) ?? null;
    assert.equal(earliestFitting(days, fitsOn), linear, `${cents} from ${from}`);
  }
});

// ---------------------------------------------------------------------------
// The route's body
// ---------------------------------------------------------------------------

test("parseWhatIfRequest: integer cents and an ISO date, nothing else", () => {
  assert.deepEqual(parseWhatIfRequest({ cents: 90000, date: "2026-11-21" }), { cents: 90000, date: "2026-11-21" });
  assert.deepEqual(parseWhatIfRequest({ cents: 0, date: "2026-11-21" }), { cents: 0, date: "2026-11-21" });
  assert.equal(parseWhatIfRequest({ cents: 12.5, date: "2026-11-21" }), null);
  assert.equal(parseWhatIfRequest({ cents: -1, date: "2026-11-21" }), null);
  assert.equal(parseWhatIfRequest({ cents: "900", date: "2026-11-21" }), null);
  assert.equal(parseWhatIfRequest({ cents: 1e15, date: "2026-11-21" }), null);
  assert.equal(parseWhatIfRequest({ cents: 100, date: "21/11/2026" }), null);
  assert.equal(parseWhatIfRequest({ cents: 100, date: "2026-13-45" }), null);
  assert.equal(parseWhatIfRequest({ cents: 100, date: "2026-02-31" }), null);
  assert.equal(parseWhatIfRequest({ cents: 100 }), null);
  assert.equal(parseWhatIfRequest(null), null);
  assert.equal(parseWhatIfRequest("cents=100"), null);
});
