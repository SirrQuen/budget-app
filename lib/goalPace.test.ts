import { test } from "node:test";
import assert from "node:assert/strict";
import { goalPaceLine, paceMonth, parseGoalPace, type GoalPace } from "./goalPace";

const TODAY = "2026-11-18";

// The dev test user's Japan trip, as goal_pace() works it out on
// 2026-11-18: $400 in September + $650 in October over the last 3
// complete months (Aug-Oct) = $350 a month; $1,950 to go blooms in May
// (Nov + ceil(1950 / 350) = 6 months); the target is April, 5 months
// away, so $1,950 / 5 = $390 a month would reach it.
const japan: GoalPace = {
  goalId: "g-japan",
  followsCard: false,
  state: "pace",
  pace: 350,
  bloomMonth: "2027-05-01",
  targetMonth: "2027-04-01",
  onPace: false,
  neededMonthly: 390,
};

test("Japan trip: blooms in May, $390 a month would bloom it by April", () => {
  const line = goalPaceLine(japan, "Japan trip", TODAY);
  assert.ok(line);
  assert.equal(line.headline, "At this pace, Japan trip blooms in May.");
  assert.equal(line.target, "About $390 a month would bloom it by April.");
  assert.equal(line.basis, "Based on about $350 a month over the last 3 months.");
  assert.equal(line.month, "2027-05-01");
});

test("on pace names the target month", () => {
  const line = goalPaceLine({ ...japan, bloomMonth: "2027-03-01", onPace: true, neededMonthly: null }, "Japan trip", TODAY);
  assert.equal(line?.target, "On pace for your April date.");
});

test("no target month (none, or already past -- SQL drops it): no target sentence", () => {
  const line = goalPaceLine({ ...japan, targetMonth: null, onPace: null, neededMonthly: null }, "Japan trip", TODAY);
  assert.equal(line?.target, null);
  assert.equal(line?.headline, "At this pace, Japan trip blooms in May.");
});

test("a debt goal reads paid off, by the card's name", () => {
  const line = goalPaceLine(
    { ...japan, followsCard: true, targetMonth: null, onPace: null, neededMonthly: null },
    "Visa",
    TODAY,
  );
  assert.equal(line?.headline, "At this pace, Visa is paid off in May.");
  assert.match(line?.basis ?? "", /a month off the balance/);
  const dated = goalPaceLine({ ...japan, followsCard: true }, "Visa", TODAY);
  assert.equal(dated?.target, "About $390 a month would pay it off by April.");
});

test("not enough history: the two lines, no month", () => {
  const saving = goalPaceLine({ ...japan, state: "not_enough", pace: null, bloomMonth: null }, "Japan trip", TODAY);
  assert.equal(saving?.headline, "Add to it a few more times and Sorrel will estimate when it blooms.");
  assert.equal(saving?.month, null);
  const debt = goalPaceLine(
    { ...japan, followsCard: true, state: "not_enough", pace: null, bloomMonth: null },
    "Visa",
    TODAY,
  );
  assert.equal(debt?.headline, "A payoff estimate appears after a few months of this card's balances.");
});

test("complete or no pace: no line at all", () => {
  assert.equal(goalPaceLine({ ...japan, state: "complete" }, "Japan trip", TODAY), null);
  assert.equal(goalPaceLine({ ...japan, state: "no_pace", pace: null, bloomMonth: null }, "Visa", TODAY), null);
});

test("a month a year or more away carries its year", () => {
  assert.equal(paceMonth("2027-10-01", TODAY), "October");
  assert.equal(paceMonth("2027-11-01", TODAY), "November 2027");
  assert.equal(paceMonth("2028-02-01", TODAY), "February 2028");
});

test("never judges, never exclaims", () => {
  const variants: GoalPace[] = [
    japan,
    { ...japan, onPace: true, neededMonthly: null },
    { ...japan, followsCard: true },
    { ...japan, state: "not_enough", pace: null, bloomMonth: null },
    { ...japan, followsCard: true, state: "not_enough", pace: null, bloomMonth: null },
  ];
  for (const p of variants) {
    const line = goalPaceLine(p, "Japan trip", TODAY);
    const text = [line?.headline, line?.target, line?.basis].join(" ");
    assert.doesNotMatch(text, /behind|off track|missed|late|overdue|can't|!/i, text);
  }
});

test("parse: a goal_pace() row; an unexpected one is dropped", () => {
  const parsed = parseGoalPace({
    goal_id: "g-japan",
    follows_card: false,
    state: "pace",
    months_with_money: 2,
    pace: 350,
    remaining: 1950,
    bloom_month: "2027-05-01",
    target_month: "2027-04-01",
    on_pace: false,
    needed_monthly: 390,
  });
  assert.deepEqual(parsed, japan);
  assert.equal(parseGoalPace({ goal_id: "x", state: "behind" }), null);
  assert.equal(parseGoalPace({ goal_id: "x", state: "pace", pace: null, bloom_month: null }), null);
});
