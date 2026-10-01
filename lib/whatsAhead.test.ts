import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysISO } from "./date";
import { projectSafeToSpend, type ProjectionSchedule } from "./safeToSpendProjection";
import { whatsAhead, type WhatsAheadItem } from "./whatsAhead";

const TODAY = "2026-10-01";
const day = (n: number) => addDaysISO(TODAY, n);

// A single occurrence on day n -- keeps each scenario's walk exactly the
// events written down, with no monthly repeat landing later in the horizon.
function once(kind: "Income" | "Expense", name: string, amount: number, n: number): ProjectionSchedule {
  return {
    recurringId: name,
    name,
    kind,
    accountId: "checking",
    fromAccountType: "Checking",
    toAccountId: null,
    toAccountType: null,
    statementDay: null,
    cardPayment: null,
    amount,
    amountLow: null,
    isEstimate: false,
    nextRunDate: day(n),
    nextDueDate: day(n),
    anchorDate: day(n),
    frequency: "Monthly",
    intervalCount: 1,
    businessDayOffset: 0,
    nonBusinessDayRule: "none",
    dateToleranceDays: 0,
    endDate: null,
    occurrencesRemaining: 1,
  };
}

function run(schedules: ProjectionSchedule[], cash: number, cushion = 300) {
  return projectSafeToSpend({
    today: TODAY,
    cash,
    cushion,
    schedules,
    holidays: new Set(),
    fallbackWindowEnd: "2026-10-31",
  });
}

const items = (view: ReturnType<typeof whatsAhead>): WhatsAheadItem[] =>
  view.kind === "episodes" ? view.items : [];

test("two separate dips with a recovery between -> 2 episodes, chronological", () => {
  const result = run(
    [
      once("Expense", "Rent", 800, 2),
      once("Income", "Paycheck", 1000, 4),
      once("Expense", "Insurance", 1000, 10),
      once("Income", "Bonus", 500, 12),
    ],
    1000,
  );

  assert.equal(result.mode, "projection");
  assert.deepEqual(
    result.episodes.map((e) => [e.startDate, e.endDate, e.recovery]),
    [
      [day(2), day(4), { date: day(4), description: "Paycheck" }],
      [day(10), day(12), { date: day(12), description: "Bonus" }],
    ],
  );
  assert.deepEqual(
    result.episodes.map((e) => e.drivers.map((d) => d.name)),
    [["Rent"], ["Insurance"]],
  );
});

test("episodes stay chronological even when a later one is worse", () => {
  const result = run(
    [
      once("Expense", "Phone", 750, 2), // down to 250 -- tight
      once("Income", "Paycheck", 1000, 4),
      once("Expense", "Rent", 1500, 8), // down to -250 -- short
      once("Income", "Bonus", 1000, 9),
    ],
    1000,
  );

  assert.deepEqual(
    result.episodes.map((e) => [e.startDate, e.severity]),
    [
      [day(2), "tight"],
      [day(8), "shortfall"],
    ],
  );
});

test("a four-day continuous dip -> one episode spanning four days, not four", () => {
  const result = run([once("Expense", "Rent", 800, 2), once("Income", "Paycheck", 1000, 5)], 1000);

  assert.equal(result.episodes.length, 1);
  assert.equal(result.episodes[0].startDate, day(2));
  assert.equal(result.episodes[0].endDate, day(5));
  assert.deepEqual(result.episodes[0].lowPoint, { amount: 200, date: day(2) });
});

test("drivers are every obligation inside the run, largest first", () => {
  const result = run(
    [
      once("Expense", "Rent", 710, 2), // 290 -- the run starts here
      once("Expense", "Phone", 60, 3), // 230
      once("Expense", "Gym", 40, 4),
      once("Income", "Paycheck", 1000, 6),
    ],
    1000,
  );

  assert.equal(result.episodes.length, 1);
  assert.deepEqual(
    result.episodes[0].drivers.map((d) => d.name),
    ["Rent", "Phone", "Gym"],
  );
});

test("the dip holding the overall trough -> containsTrough, and the UI lists it once", () => {
  const result = run(
    [
      once("Expense", "Rent", 800, 2), // 200
      once("Income", "Paycheck", 1000, 4),
      once("Expense", "Insurance", 1100, 10), // 100 -- the trough
      once("Income", "Bonus", 500, 12),
    ],
    1000,
  );

  assert.equal(result.trough.date, day(10));
  assert.deepEqual(
    result.episodes.map((e) => e.containsTrough),
    [false, true],
  );
  // The trough episode's low point is the same number as the trough line.
  assert.deepEqual(result.episodes[1].lowPoint, { amount: result.trough.amount, date: result.trough.date });

  const shown = items(whatsAhead(result));
  assert.equal(shown.length, 2);
  assert.equal(new Set(shown.map((i) => i.key)).size, 2);
  assert.deepEqual(
    shown.map((i) => i.isLowestPoint),
    [false, true],
  );
  assert.equal(shown.filter((i) => i.headline.includes("$100.00")).length, 1);
});

test("still below the line on the final horizon day -> openEnded, no recovery date rendered", () => {
  const result = run([once("Income", "Paycheck", 100, 3), once("Expense", "Rent", 900, 30)], 1000);

  assert.equal(result.horizonEnd, day(35));
  assert.equal(result.episodes.length, 1);
  const [e] = result.episodes;
  assert.equal(e.endDate, result.horizonEnd);
  assert.equal(e.openEnded, true);
  assert.equal(e.recovery, null);

  const [item] = items(whatsAhead(result));
  assert.equal(item.recovery, "Continues past the end of the forecast.");
  assert.ok(!/\d/.test(item.recovery));
});

test("income on the final horizon day that lifts the balance -> a recovery, not open-ended", () => {
  const result = run(
    [once("Income", "Early", 100, 3), once("Expense", "Rent", 900, 30), once("Income", "Paycheck", 1000, 35)],
    1000,
  );

  assert.equal(result.horizonEnd, day(35));
  assert.equal(result.episodes[0].openEnded, false);
  assert.deepEqual(result.episodes[0].recovery, { date: day(35), description: "Paycheck" });
});

test("balance never falls below the cushion -> no episodes, and the single 'no tight days' line", () => {
  const result = run([once("Income", "Paycheck", 1500, 5), once("Expense", "Rent", 500, 7)], 2000);

  assert.deepEqual(result.episodes, []);
  assert.deepEqual(whatsAhead(result), { kind: "clear", line: "No tight days in the next five weeks." });
});

test("a day exactly at the cushion is clear, not tight", () => {
  const result = run([once("Income", "Paycheck", 1000, 4), once("Expense", "Rent", 700, 2)], 1000);

  assert.equal(result.trough.amount, 300);
  assert.deepEqual(result.episodes, []);
});

test("a day exactly at zero is tight, not short", () => {
  const result = run([once("Expense", "Rent", 1000, 2), once("Income", "Paycheck", 1000, 4)], 1000);

  assert.equal(result.episodes.length, 1);
  assert.equal(result.episodes[0].severity, "tight");
  assert.deepEqual(result.episodes[0].lowPoint, { amount: 0, date: day(2) });
});

function sevenDips() {
  const schedules: ProjectionSchedule[] = [];
  for (let k = 0; k < 7; k++) {
    schedules.push(once("Expense", `Bill ${k + 1}`, 800, 2 + 4 * k));
    schedules.push(once("Income", `Pay ${k + 1}`, 800, 3 + 4 * k));
  }
  return run(schedules, 1000);
}

test("seven episodes -> exactly 5 rendered plus an accurate 'and N more'", () => {
  const result = sevenDips();
  assert.equal(result.episodes.length, 7);

  const view = whatsAhead(result);
  assert.equal(view.kind, "episodes");
  assert.equal(items(view).length, 5);
  assert.deepEqual(
    items(view).map((i) => i.key),
    result.episodes.slice(0, 5).map((e) => e.startDate),
  );
  assert.equal(view.kind === "episodes" ? view.more : null, "and 2 more later in the forecast");
});

test("exactly five episodes -> all five, no 'more' line", () => {
  const result = run(
    Array.from({ length: 5 }, (_, k) => [
      once("Expense", `Bill ${k + 1}`, 800, 2 + 4 * k),
      once("Income", `Pay ${k + 1}`, 800, 3 + 4 * k),
    ]).flat(),
    1000,
  );

  const view = whatsAhead(result);
  assert.equal(items(view).length, 5);
  assert.equal(view.kind === "episodes" ? view.more : undefined, null);
});

test("shortfall and tight phrasing", () => {
  const short = run([once("Expense", "Rent", 1180, 13), once("Income", "Paycheck", 1000, 14)], 1000);
  assert.equal(items(whatsAhead(short))[0].headline, "Projected $180.00 short on 14 October");

  const tight = run([once("Expense", "Rent", 300, 2), once("Income", "Paycheck", 1000, 2)], 440);
  const [item] = items(whatsAhead(tight));
  assert.equal(item.when, "3 October");
  assert.equal(item.headline, "Down to $140.00, below your $300.00 cushion");
  assert.equal(item.cause, "Rent ($300.00) lands that day.");
  assert.equal(item.recovery, "Back above your cushion on 3 October, when Paycheck comes in.");
});

test("a multi-day run names its range and the day of its low", () => {
  const result = run([once("Expense", "Rent", 800, 2), once("Income", "Paycheck", 1000, 5)], 1000);
  const [item] = items(whatsAhead(result));

  assert.equal(item.when, "3–6 October");
  assert.equal(item.headline, "Down to $200.00, below your $300.00 cushion on 3 October");
  assert.equal(item.cause, "Rent ($800.00) lands in this stretch.");
});

test("a run already under way today names today's balance as its start", () => {
  const result = run([once("Income", "Paycheck", 1000, 3)], 100);
  const [item] = items(whatsAhead(result));

  assert.equal(result.episodes[0].startDate, TODAY);
  assert.equal(item.cause, "Starts from today's balance.");
});

test("no user-facing string uses alarm words or exclamation marks", () => {
  const banned = /\b(alert|warning|danger|risk|overdraft|negative)\b|!/i;
  const scenarios = [
    sevenDips(),
    run([once("Expense", "Rent", 1500, 2), once("Income", "Paycheck", 1000, 4)], 1000),
    run([once("Income", "Paycheck", 100, 3), once("Expense", "Rent", 900, 30)], 1000),
    run([once("Income", "Paycheck", 1500, 5)], 2000),
  ];

  for (const result of scenarios) {
    const view = whatsAhead(result);
    const strings =
      view.kind === "clear"
        ? [view.line]
        : [...view.items.flatMap((i) => [i.when, i.headline, i.cause, i.recovery]), view.more ?? ""];
    for (const s of strings) assert.ok(!banned.test(s), s);
  }
});
