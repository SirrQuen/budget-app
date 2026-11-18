import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysISO, endOfMonthISO } from "./date";
import { nextOccurrenceISO } from "./recurringCadence";
import { lastDayAnchor, nextLastDay, onboardingStep, paycheckPlans, type PaycheckSchedulePlan } from "./onboarding";

const TODAY = "2026-11-17";

// ---------------------------------------------------------------------------
// Which step
// ---------------------------------------------------------------------------

test("onboardingStep: derived from what exists, plus the skip", () => {
  assert.equal(onboardingStep({ stage: "no-accounts", anyIncome: false, skippedPayday: false }), 1);
  // A skip cookie or an income schedule can't hide step 1.
  assert.equal(onboardingStep({ stage: "no-accounts", anyIncome: true, skippedPayday: true }), 1);
  assert.equal(onboardingStep({ stage: "no-transactions", anyIncome: false, skippedPayday: false }), 2);
  assert.equal(onboardingStep({ stage: "no-transactions", anyIncome: true, skippedPayday: false }), null);
  assert.equal(onboardingStep({ stage: "no-transactions", anyIncome: false, skippedPayday: true }), null);
});

test("onboardingStep: anyone with a transaction never sees onboarding, paycheck or not", () => {
  for (const stage of ["early", "full"] as const) {
    assert.equal(onboardingStep({ stage, anyIncome: false, skippedPayday: false }), null);
  }
});

// ---------------------------------------------------------------------------
// Last day of the month: a 31st anchor, true month-ends for 13 months
// ---------------------------------------------------------------------------

function walk(plan: PaycheckSchedulePlan, n = 13): string[] {
  const out = [plan.next_run_date];
  let d = plan.next_run_date;
  for (let i = 1; i < n; i++) {
    d = nextOccurrenceISO(d, plan.frequency, plan.interval_count, plan.start_date);
    out.push(d);
  }
  return out;
}

function onlyMonthEnds(dates: string[]) {
  for (const d of dates) assert.equal(d, endOfMonthISO(d), `${d} isn't a month's last day`);
  for (let i = 1; i < dates.length; i++) {
    assert.equal(dates[i], endOfMonthISO(addDaysISO(dates[i - 1], 1)), `${dates[i - 1]} -> ${dates[i]}`);
  }
}

function plansOf(r: ReturnType<typeof paycheckPlans>): PaycheckSchedulePlan[] {
  assert.ok(Array.isArray(r), JSON.stringify(r));
  return r;
}

test("last day: first payday Nov 30 gives true month-ends for 13 months", () => {
  const [plan] = plansOf(paycheckPlans("monthly", [{ date: "2026-11-30", lastDay: true }], TODAY));
  assert.equal(plan.next_run_date, "2026-11-30");
  assert.equal(plan.start_date, "2026-10-31");
  const dates = walk(plan);
  onlyMonthEnds(dates);
  assert.deepEqual(dates.slice(0, 5), ["2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31"]);
});

test("last day: first payday Feb 28 gives true month-ends for 13 months", () => {
  const [plan] = plansOf(paycheckPlans("monthly", [{ date: "2027-02-28", lastDay: true }], "2027-02-01"));
  assert.equal(plan.start_date, "2027-01-31");
  const dates = walk(plan);
  onlyMonthEnds(dates);
  assert.deepEqual(dates.slice(0, 3), ["2027-02-28", "2027-03-31", "2027-04-30"]);
  assert.equal(dates[12], "2028-02-29"); // and the leap year's
});

test("last day: first payday Feb 29 of a leap year gives true month-ends for 13 months", () => {
  const [plan] = plansOf(paycheckPlans("monthly", [{ date: "2028-02-29", lastDay: true }], "2028-02-01"));
  assert.equal(plan.start_date, "2028-01-31");
  const dates = walk(plan);
  onlyMonthEnds(dates);
  assert.deepEqual(dates.slice(0, 3), ["2028-02-29", "2028-03-31", "2028-04-30"]);
  assert.equal(dates[12], "2029-02-28");
});

test("without the choice, a 30th stays the 30th -- the reason for the anchor", () => {
  const [plan] = plansOf(paycheckPlans("monthly", [{ date: "2026-11-30", lastDay: false }], TODAY));
  assert.deepEqual(walk(plan, 3), ["2026-11-30", "2026-12-30", "2027-01-30"]);
});

test("lastDayAnchor: the nearest 31st on or before the payday", () => {
  assert.equal(lastDayAnchor("2026-12-31"), "2026-12-31");
  assert.equal(lastDayAnchor("2026-11-30"), "2026-10-31");
  assert.equal(lastDayAnchor("2027-04-30"), "2027-03-31");
  assert.equal(lastDayAnchor("2027-02-28"), "2027-01-31");
  assert.equal(lastDayAnchor("2026-09-30"), "2026-08-31");
});

test("nextLastDay: this month's last day", () => {
  assert.equal(nextLastDay("2026-11-17"), "2026-11-30");
  assert.equal(nextLastDay("2026-11-30"), "2026-11-30");
  assert.equal(nextLastDay("2027-02-03"), "2027-02-28");
});

// ---------------------------------------------------------------------------
// Each frequency
// ---------------------------------------------------------------------------

test("weekly: one Weekly schedule, interval 1, from the payday", () => {
  assert.deepEqual(paycheckPlans("weekly", [{ date: "2026-11-20", lastDay: false }], TODAY), [
    { frequency: "Weekly", interval_count: 1, next_run_date: "2026-11-20", start_date: "2026-11-20" },
  ]);
});

test("every 2 weeks: one Weekly schedule, interval 2", () => {
  const plans = plansOf(paycheckPlans("every_2_weeks", [{ date: "2026-11-27", lastDay: false }], TODAY));
  assert.deepEqual(plans, [{ frequency: "Weekly", interval_count: 2, next_run_date: "2026-11-27", start_date: "2026-11-27" }]);
  assert.deepEqual(walk(plans[0], 3), ["2026-11-27", "2026-12-11", "2026-12-25"]);
});

test("monthly: one Monthly schedule anchored on its own day", () => {
  assert.deepEqual(paycheckPlans("monthly", [{ date: "2026-12-01", lastDay: false }], TODAY), [
    { frequency: "Monthly", interval_count: 1, next_run_date: "2026-12-01", start_date: "2026-12-01" },
  ]);
});

test("twice a month: two Monthly schedules, the last-day one anchored on a 31st", () => {
  const plans = plansOf(
    paycheckPlans(
      "twice_a_month",
      [
        { date: "2026-12-15", lastDay: false },
        { date: "2026-11-30", lastDay: true },
      ],
      TODAY,
    ),
  );
  assert.deepEqual(plans, [
    { frequency: "Monthly", interval_count: 1, next_run_date: "2026-12-15", start_date: "2026-12-15" },
    { frequency: "Monthly", interval_count: 1, next_run_date: "2026-11-30", start_date: "2026-10-31" },
  ]);
  onlyMonthEnds(walk(plans[1]));
  assert.deepEqual(walk(plans[0], 3), ["2026-12-15", "2027-01-15", "2027-02-15"]);
});

test("refused: past, too far, a non-month-end last day, two of the same day, a missing second payday", () => {
  const err = (r: unknown) => assert.ok(r !== null && typeof r === "object" && "error" in r, JSON.stringify(r));
  err(paycheckPlans("monthly", [{ date: "2026-11-16", lastDay: false }], TODAY));
  err(paycheckPlans("monthly", [{ date: "2027-02-01", lastDay: false }], TODAY));
  err(paycheckPlans("monthly", [{ date: "2026-11-29", lastDay: true }], TODAY));
  err(paycheckPlans("weekly", [{ date: "2026-11-30", lastDay: false }], TODAY));
  err(paycheckPlans("twice_a_month", [{ date: "2026-11-30", lastDay: true }], TODAY));
  err(
    paycheckPlans(
      "twice_a_month",
      [
        { date: "2026-12-31", lastDay: false },
        { date: "2026-11-30", lastDay: true },
      ],
      TODAY,
    ),
  );
  err(paycheckPlans("monthly", [], TODAY));
});
