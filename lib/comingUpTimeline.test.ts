import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysISO } from "./date";
import { projectSafeToSpend, type ProjectionSchedule } from "./safeToSpendProjection";
import { buildUpcomingOccurrences, UPCOMING_DEFAULT_DAYS } from "./upcomingOccurrences";
import { buildTimelineDays, dayLabel } from "./comingUpTimeline";

const TODAY = "2026-11-18";
const day = (n: number) => addDaysISO(TODAY, n);

function schedule(
  overrides: Partial<ProjectionSchedule> & Pick<ProjectionSchedule, "kind" | "amount" | "name">,
): ProjectionSchedule {
  const next = overrides.nextDueDate ?? day(1);
  return {
    recurringId: overrides.name,
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

function build(schedules: ProjectionSchedule[]) {
  const projection = projectSafeToSpend({
    today: TODAY,
    cash: 3000,
    cushion: 0,
    goalHolds: [],
    schedules,
    futureTransactions: [],
    holidays: new Set(),
    fallbackWindowEnd: "2026-12-31",
  });
  return { projection, list: buildUpcomingOccurrences(projection, TODAY) };
}

const rent = schedule({ kind: "Expense", name: "Rent", amount: 1200, nextDueDate: day(3) });
const car = schedule({ kind: "Expense", name: "Car", amount: 300, nextDueDate: day(3) });
const pay = schedule({ kind: "Income", name: "Pay", amount: 900, nextDueDate: day(5) });
const later = schedule({ kind: "Expense", name: "Later", amount: 50, nextDueDate: day(20) });
const toSavings = schedule({
  kind: "Transfer",
  name: "To savings",
  amount: 100,
  toAccountId: "savings",
  toAccountType: "Savings",
  nextDueDate: day(6),
});
const withinSet = schedule({
  kind: "Transfer",
  name: "Checking to cash",
  amount: 40,
  toAccountId: "cash",
  toAccountType: "Cash",
  nextDueDate: day(7),
});

test("fourteen days from today, today first", () => {
  const { list, projection } = build([rent]);
  const days = buildTimelineDays(list, TODAY, projection.trough.date);
  assert.equal(days.length, UPCOMING_DEFAULT_DAYS);
  assert.equal(days[0].date, TODAY);
  assert.equal(days[13].date, day(13));
});

test("the timeline holds exactly the items the list shows for the same window", () => {
  const { list, projection } = build([rent, car, pay, later, toSavings, withinSet]);
  const days = buildTimelineDays(list, TODAY, projection.trough.date);
  const fromTimeline = days.flatMap((d) => d.items.map((i) => i.key)).sort();
  const fromList = list.items
    .filter((i) => i.status !== "missed" && i.date <= list.windowEnd)
    .map((i) => i.key)
    .sort();
  assert.deepEqual(fromTimeline, fromList);
  // The one at day 20 is past the window; a transfer inside the set isn't an item at all.
  assert.ok(!fromTimeline.some((k) => k.startsWith("Later")));
  assert.ok(!fromTimeline.some((k) => k.startsWith("Checking to cash")));
  assert.ok(fromTimeline.some((k) => k.startsWith("To savings")));
});

test("a day with two items shows both, bills before income", () => {
  const sameDayPay = schedule({ kind: "Income", name: "Pay", amount: 900, nextDueDate: day(3) });
  const { list, projection } = build([rent, sameDayPay]);
  const d = buildTimelineDays(list, TODAY, projection.trough.date)[3];
  assert.deepEqual(
    d.items.map((i) => i.name),
    ["Rent", "Pay"],
  );
});

test("the leaf sits on the hero's tightest day, and only inside the window", () => {
  const once = (s: ProjectionSchedule) => ({ ...s, occurrencesRemaining: 1 });
  const { list, projection } = build([once(rent), once(car), once(pay)]);
  const days = buildTimelineDays(list, TODAY, projection.trough.date);
  assert.deepEqual(
    days.filter((d) => d.tightest).map((d) => d.date),
    [projection.trough.date],
  );
  assert.equal(projection.trough.date, day(3));

  const outside = buildTimelineDays(list, TODAY, day(20));
  assert.equal(outside.some((d) => d.tightest), false);
});

test("a day's label names the day, each item and its amount", () => {
  const { list } = build([rent, car, pay]);
  const days = buildTimelineDays(list, TODAY, day(3));
  assert.match(dayLabel(days[3]), /^\w+, Nov 21: Car, \$300\.00; Rent, \$1,200\.00\. Your tightest day$/);
  assert.match(dayLabel(days[5]), /Pay, \$900\.00 coming in$/);
  assert.match(dayLabel(days[1]), /: nothing due$/);
});
