import { test } from "node:test";
import assert from "node:assert/strict";
import { endDateOrderError, isFinished, isScheduledOccurrence, remainingOccurrences } from "./recurringEnds";
import { expandOccurrences, projectSafeToSpend, type ProjectionSchedule } from "./safeToSpendProjection";
import { buildConfirmationQueue } from "./confirmationQueue";
import { findSameBillPairs, type SameBillSchedule } from "./sameBill";

// The end rule (migration 79, ruled 2026-11-22). Its SQL twin is checked
// against these same semantics by docs/recurring-ends-test.sql and
// `npm run test:parity:ends`.

const TODAY = "2026-11-22"; // a Sunday
const NO_HOLIDAYS: ReadonlySet<string> = new Set();

function schedule(overrides: Partial<ProjectionSchedule>): ProjectionSchedule {
  const next = overrides.nextRunDate ?? "2026-11-25";
  return {
    recurringId: "s",
    name: "Bill",
    kind: "Expense",
    amount: 100,
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

const dues = (s: ProjectionSchedule) => expandOccurrences(s, "2027-06-30", NO_HOLIDAYS).map((o) => o.due);

test("remaining: N minus done, never below 0, null without a limit", () => {
  assert.equal(remainingOccurrences(null, 5), null);
  assert.equal(remainingOccurrences(3, 0), 3);
  assert.equal(remainingOccurrences(3, 3), 0);
  assert.equal(remainingOccurrences(1, 2), 0);
});

test("After N: finished at N done; a skip (nothing done) leaves it open", () => {
  assert.equal(isFinished({ endDate: null, occurrencesRemaining: remainingOccurrences(1, 1) }, TODAY), true);
  assert.equal(isFinished({ endDate: null, occurrencesRemaining: remainingOccurrences(1, 0) }, TODAY), false);
  assert.deepEqual(dues(schedule({ occurrencesRemaining: 2 })), ["2026-11-25", "2026-12-25"]);
});

test("On date: inclusive, decided on the scheduled date", () => {
  assert.equal(isScheduledOccurrence({ endDate: "2026-12-25", occurrencesRemaining: null }, "2026-12-25", 0), true);
  assert.equal(isScheduledOccurrence({ endDate: "2026-12-24", occurrencesRemaining: null }, "2026-12-25", 0), false);
  assert.deepEqual(dues(schedule({ endDate: "2026-12-25" })), ["2026-11-25", "2026-12-25"]);
});

test("C1: the next cycle is past the end date, which hasn't passed -- finished, nothing counted", () => {
  const s = schedule({ nextRunDate: "2026-12-18", endDate: "2026-11-27" });
  assert.equal(isFinished(s, s.nextRunDate), true);
  assert.deepEqual(dues(s), []);
  assert.deepEqual(buildConfirmationQueue([s], TODAY, NO_HOLIDAYS), []);
});

test("C3: the last occurrence before the end date stays until answered, after the end date passes", () => {
  const s = schedule({ nextRunDate: "2026-11-17", endDate: "2026-11-21" });
  assert.equal(isFinished(s, s.nextRunDate), false);
  assert.deepEqual(dues(s), ["2026-11-17"]);
  const q = buildConfirmationQueue([s], TODAY, NO_HOLIDAYS);
  assert.deepEqual(q.map((i) => `${i.state} ${i.dueDate}`), ["to-confirm 2026-11-17"]);
  // ...and the forecast still counts it, today (an obligation whose date has passed).
  const p = projectSafeToSpend({
    today: TODAY,
    cash: 1000,
    cushion: 0,
    goalHolds: [],
    schedules: [s],
    futureTransactions: [],
    holidays: NO_HOLIDAYS,
    fallbackWindowEnd: "2026-11-30",
  });
  assert.equal(p.obligations.length, 1);
});

test("business-day edge: scheduled ON the end date, posting after it -- included", () => {
  // 2026-11-28 is a Saturday; a one-business-day offset posts it Monday the 30th.
  const s = schedule({
    nextRunDate: "2026-11-28",
    nextDueDate: "2026-11-30",
    anchorDate: "2026-11-28",
    businessDayOffset: 1,
    endDate: "2026-11-28",
  });
  assert.equal(isFinished(s, s.nextRunDate), false);
  assert.deepEqual(dues(s), ["2026-11-30"]);
});

test("same bill reads the same rule -- the scheduled date, not the posting date", () => {
  const sb = (o: Partial<SameBillSchedule>): SameBillSchedule => ({
    recurringId: "r",
    name: "Rent",
    kind: "Expense",
    accountId: "checking",
    toAccountId: null,
    amount: 100,
    nextRunDate: "2026-11-28",
    nextDueDate: "2026-11-30",
    dateToleranceDays: 0,
    endDate: "2026-11-28",
    occurrencesRemaining: null,
    ...o,
  });
  const entry = {
    transactionId: "t",
    kind: "Expense" as const,
    accountId: "checking",
    toAccountId: null,
    amount: 100,
    date: "2026-11-30",
    linked: false,
  };
  assert.equal(findSameBillPairs([sb({})], [entry], new Set(), TODAY).length, 1);
  assert.equal(findSameBillPairs([sb({ endDate: "2026-11-27" })], [entry], new Set(), TODAY).length, 0);
  assert.equal(findSameBillPairs([sb({ occurrencesRemaining: 0 })], [entry], new Set(), TODAY).length, 0);
});

test("the end-date order check: asked when either date is set, never on a rename", () => {
  const msg = "The end date can't be before the next date.";
  // Create: always asked.
  assert.equal(endDateOrderError({ next_run_date: "2026-12-18", end_date: "2026-11-27" }, null), msg);
  assert.equal(endDateOrderError({ next_run_date: "2026-11-27", end_date: "2026-11-27" }, null), null);
  // An ended On-date schedule (next date already past its end), renamed: both dates as stored.
  const ended = { next_run_date: "2026-12-18", end_date: "2026-11-27" };
  assert.equal(endDateOrderError({ ...ended }, ended), null);
  // ...an end date moved, still before the next date: asked.
  assert.equal(endDateOrderError({ next_run_date: "2026-12-18", end_date: "2026-11-30" }, ended), msg);
  // ...the next date moved: asked.
  assert.equal(endDateOrderError({ next_run_date: "2026-12-20", end_date: "2026-11-27" }, ended), msg);
  // ...extended past the next date: saves (revives it).
  assert.equal(endDateOrderError({ next_run_date: "2026-12-18", end_date: "2027-01-31" }, ended), null);
  // No end date at all: nothing to order.
  assert.equal(endDateOrderError({ next_run_date: "2026-12-18", end_date: null }, ended), null);
});
