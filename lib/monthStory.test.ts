import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RECAP_MIN_LOGS,
  buildRecapCards,
  monthName,
  parseMonthStory,
  previousMonthStart,
  recapCookieName,
  recapMonthFor,
  shareLines,
  shareTitle,
  type MonthStory,
} from "./monthStory";
import { formatCurrencyInSentence } from "./format";

// The dev test user's October 2026, as month_story() returned it in the
// Phase 1 report (archived Emergency fund excluded).
const october: MonthStory = {
  monthStart: "2026-10-01",
  logs: 18,
  goalTotal: 950,
  goals: [
    { goalId: "g-japan", name: "Japan trip", amount: 650, pctByMonthEnd: 35 },
    { goalId: "g-bike", name: "Bike fund", amount: 300, pctByMonthEnd: 100 },
  ],
  cards: [],
};

test("the recap is last month, in the first 7 days of a month only", () => {
  assert.equal(previousMonthStart("2026-12-01"), "2026-11-01");
  assert.equal(previousMonthStart("2027-01-05"), "2026-12-01");
  assert.equal(recapMonthFor("2026-12-01"), "2026-11-01");
  assert.equal(recapMonthFor("2026-12-07"), "2026-11-01");
  assert.equal(recapMonthFor("2026-12-08"), null);
  assert.equal(recapMonthFor("2026-11-16"), null);
  assert.equal(recapMonthFor("2027-03-01"), "2027-02-01");
});

test("the dismissal cookie is named with the month, so next month starts unseen", () => {
  assert.equal(recapCookieName("2026-10-01"), "sorrel_recap_seen_2026-10");
  assert.notEqual(recapCookieName("2026-11-01"), recapCookieName("2026-10-01"));
});

test("month names", () => {
  assert.equal(monthName("2026-10-01"), "October");
  assert.equal(monthName("2027-01-01"), "January");
});

test("fewer than 5 hand logs: no recap at all", () => {
  assert.equal(RECAP_MIN_LOGS, 5);
  assert.equal(buildRecapCards({ ...october, logs: 4 }, 500), null);
  assert.equal(buildRecapCards({ ...october, logs: 0 }, 500), null);
  assert.notEqual(buildRecapCards({ ...october, logs: 5 }, 500), null);
});

test("the dev test user's October, card by card", () => {
  const cards = buildRecapCards(october, 1234.5);
  assert.ok(cards);
  assert.deepEqual(
    cards.map((c) => c.sentence),
    [
      "Your October. A look back at your month.",
      "You logged 18 times in October.",
      "You set aside $950 for your goals, $650 of it for Japan trip.",
      "Right now, you have $1,234.50 safe to spend.",
    ],
  );
  const goals = cards.find((c) => c.id === "goals");
  assert.deepEqual(goals?.meter, { name: "Japan trip", pct: 35 });
});

test("one goal: the ruled wording", () => {
  const cards = buildRecapCards(
    { ...october, goalTotal: 650, goals: [october.goals[0]] },
    null,
  );
  assert.equal(cards?.find((c) => c.id === "goals")?.sentence, "You set aside $650 for Japan trip.");
});

test("no goal money: the goals card is left out", () => {
  const cards = buildRecapCards({ ...october, goalTotal: 0, goals: [] }, 100);
  assert.deepEqual(cards?.map((c) => c.id), ["intro", "logs", "closing"]);
});

test("safe to spend at $0 or unreadable: the closing card is left out", () => {
  assert.equal(buildRecapCards(october, 0)?.some((c) => c.id === "closing"), false);
  assert.equal(buildRecapCards(october, null)?.some((c) => c.id === "closing"), false);
});

test("a card that went down is shown; one that went up never is", () => {
  const cards = buildRecapCards(
    {
      ...october,
      cards: [
        { goalId: "d1", cardName: "Visa", amount: 40.88 },
        { goalId: "d2", cardName: "Amex", amount: -120 },
        { goalId: "d3", cardName: "Loan", amount: 0 },
      ],
    },
    null,
  );
  const paid = cards?.filter((c) => c.id.startsWith("card-")) ?? [];
  assert.deepEqual(paid.map((c) => c.sentence), ["You paid Visa down by $40.88 in October."]);
});

test("no card compares, scolds or shouts", () => {
  const cards = buildRecapCards(
    { ...october, cards: [{ goalId: "d1", cardName: "Visa", amount: 40.88 }] },
    300,
  );
  for (const c of cards ?? []) {
    for (const text of [c.sentence, c.shareLine ?? "", c.shareLineHidden ?? ""]) {
      assert.doesNotMatch(text, /!/, text);
      assert.doesNotMatch(text, /overspen|last month|than |other people|average|behind|over budget/i, text);
    }
  }
});

test("share lines: amounts hidden by default leave no figure behind", () => {
  const cards = buildRecapCards(
    { ...october, cards: [{ goalId: "d1", cardName: "Visa", amount: 40.88 }] },
    300,
  );
  assert.ok(cards);
  const hidden = shareLines(cards, false);
  assert.deepEqual(hidden, ["Logged 18 times", "Set money aside for my goals", "Paid Visa down"]);
  for (const line of hidden) assert.doesNotMatch(line, /\$/, line);
  assert.deepEqual(shareLines(cards, true), [
    "Logged 18 times",
    "Set aside $950 for my goals",
    "Paid Visa down by $40.88",
    "$300 safe to spend right now",
  ]);
  assert.equal(shareTitle(october), "My October");
});

test("month_story()'s row: numerics as strings or numbers, anything malformed is no recap", () => {
  const row = {
    month_start: "2026-10-01",
    logs: 18,
    goal_total: "950.00",
    goals: [{ goal_id: "g-japan", name: "Japan trip", amount: 650.0, pct_by_month_end: 35.0 }],
    cards: [{ goal_id: "d1", card_name: "Visa", amount: "40.88" }],
  };
  assert.deepEqual(parseMonthStory(row), {
    monthStart: "2026-10-01",
    logs: 18,
    goalTotal: 950,
    goals: [{ goalId: "g-japan", name: "Japan trip", amount: 650, pctByMonthEnd: 35 }],
    cards: [{ goalId: "d1", cardName: "Visa", amount: 40.88 }],
  });
  assert.equal(parseMonthStory({ ...row, logs: null }), null);
  assert.equal(parseMonthStory({ ...row, goals: null }), null);
  assert.equal(parseMonthStory({ ...row, goals: [{ goal_id: "x" }] }), null);
  assert.equal(parseMonthStory({ ...row, goal_total: "lots" }), null);
});

test("figures in a sentence drop only a .00", () => {
  assert.equal(formatCurrencyInSentence(650), "$650");
  assert.equal(formatCurrencyInSentence(950.0), "$950");
  assert.equal(formatCurrencyInSentence(40.88), "$40.88");
  assert.equal(formatCurrencyInSentence(40.8), "$40.80");
  assert.equal(formatCurrencyInSentence(1234.5), "$1,234.50");
});
