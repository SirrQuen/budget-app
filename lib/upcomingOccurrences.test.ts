import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysISO } from "./date";
import { projectSafeToSpend, type ProjectionSchedule } from "./safeToSpendProjection";
import { buildUpcomingOccurrences } from "./upcomingOccurrences";

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

function upcoming(schedules: ProjectionSchedule[]) {
  const projection = projectSafeToSpend({
    today: TODAY,
    cash: 2000,
    cushion: 0,
    schedules,
    holidays: new Set(),
    fallbackWindowEnd: "2026-10-31",
  });
  return { projection, list: buildUpcomingOccurrences(projection, TODAY) };
}

const weeklyPay = schedule({ kind: "Income", name: "Pay", amount: 500, frequency: "Weekly", nextDueDate: day(7) });
const rent = schedule({ kind: "Expense", name: "Rent", amount: 1200, nextDueDate: day(7) });

test("every occurrence the projection counts is listed -- income and bills, across the whole horizon", () => {
  const { projection, list } = upcoming([weeklyPay, rent]);

  assert.equal(list.horizonEnd, projection.horizonEnd);
  assert.equal(list.items.filter((i) => i.direction === "income").length, projection.incomes.length);
  assert.equal(list.items.filter((i) => i.direction === "bill").length, projection.obligations.length);
  // Not one per schedule: five weekly paychecks in a 35-day horizon.
  assert.equal(list.items.filter((i) => i.name === "Pay").length, 5);
  assert.ok(list.items.every((i) => i.date <= projection.horizonEnd));
});

test("mixed, sorted by date, and a same-day bill comes before the paycheck", () => {
  const { list } = upcoming([weeklyPay, rent]);

  const dates = list.items.map((i) => i.date);
  assert.deepEqual(dates, [...dates].sort());
  assert.deepEqual(
    list.items.slice(0, 2).map((i) => [i.name, i.date]),
    [
      ["Rent", day(7)],
      ["Pay", day(7)],
    ],
  );
});

test("a paycheck dropped for lack of confirmation is listed as missed, not omitted", () => {
  const stale = schedule({ kind: "Income", name: "Pay", amount: 500, frequency: "Weekly", nextDueDate: day(-3) });
  const { projection, list } = upcoming([stale]);

  assert.equal(projection.unconfirmedIncome.length, 1);
  assert.deepEqual(
    list.items.filter((i) => i.status === "missed").map((i) => [i.name, i.date, i.amount]),
    [["Pay", day(-3), 500]],
  );
  // It sorts first -- it's in the past.
  assert.equal(list.items[0].status, "missed");
  // The missed one isn't double-listed as counted income.
  assert.ok(!list.items.some((i) => i.status === "expected" && i.dueDate === day(-3)));
});

test("expected: every income occurrence, and a bill only when its amount is an estimate", () => {
  const variableBill = schedule({ kind: "Expense", name: "Power", amount: 90, isEstimate: true, nextDueDate: day(10) });
  const { list } = upcoming([weeklyPay, rent, variableBill]);

  const statusOf = (name: string) => [...new Set(list.items.filter((i) => i.name === name).map((i) => i.status))];
  assert.deepEqual(statusOf("Pay"), ["expected"]);
  assert.deepEqual(statusOf("Rent"), ["known"]);
  assert.deepEqual(statusOf("Power"), ["expected"]);
});

test("keys stay unique when missed bill occurrences all land on today", () => {
  const gym = schedule({ kind: "Expense", name: "Gym", amount: 20, frequency: "Weekly", nextDueDate: day(-10) });
  const { list } = upcoming([weeklyPay, gym]);

  const keys = list.items.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(list.items.filter((i) => i.name === "Gym" && i.date === TODAY).length >= 2);
});

test("the default window is 14 days, today included", () => {
  const { list } = upcoming([weeklyPay]);
  assert.equal(list.windowEnd, day(13));
});
