import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysISO } from "./date";
import { projectSafeToSpend, type ProjectionSchedule } from "./safeToSpendProjection";
import { cautionLine, figureUnchangedNote, whatsAhead, whyThisNumber, type WhatsAheadItem } from "./whatsAhead";
import { formatDateWithWeekday } from "./format";
import type { ProjectionTransaction } from "./safeToSpendProjection";

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
    amountHigh: null,
    amountBasis: "fixed",
    forecastBasis: null,
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
    goalHolds: [],
    schedules,
    futureTransactions: [],
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
  assert.deepEqual(whatsAhead(result), {
    kind: "clear",
    line: "No tight days in the next five weeks. Your lowest point, $2,000.00 today, doesn't go below your $300.00 cushion.",
  });
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
  assert.equal(item.cause, "Rent ($300.00, fixed) lands that day.");
  assert.equal(item.recovery, "Back above your cushion on 3 October, when Paycheck comes in.");
});

test("a multi-day run names its range and the day of its low", () => {
  const result = run([once("Expense", "Rent", 800, 2), once("Income", "Paycheck", 1000, 5)], 1000);
  const [item] = items(whatsAhead(result));

  assert.equal(item.when, "3–6 October");
  assert.equal(item.headline, "Down to $200.00, below your $300.00 cushion on 3 October");
  assert.equal(item.cause, "Rent ($800.00, fixed) lands in this stretch.");
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
    // Tightest day is the day after today -- named by weekday and date.
    run([once("Expense", "Rent", 500, 1), once("Income", "Paycheck", 1000, 1)], 1000),
  ];

  for (const result of scenarios) {
    const view = whatsAhead(result);
    const strings =
      view.kind === "clear"
        ? [view.line]
        : [...view.items.flatMap((i) => [i.when, i.headline, i.cause, i.recovery]), view.more ?? ""];
    const why = whyThisNumber(result);
    const all = [...strings, why.cause, why.consequence ?? ""];
    for (const s of all) assert.ok(!banned.test(s), s);
    // Relative words go stale on a page left open (docs/Safe-to-Spend-Why.md).
    for (const s of all) assert.ok(!/\b(tomorrow|yesterday)\b|\bin \d+ days?\b/i.test(s), s);
  }
});

test("the caution line names bills, pay, or both -- and is absent when nothing was adjusted", () => {
  assert.equal(cautionLine({ billsAtHigh: false, payAtLow: false }), null);
  assert.equal(cautionLine({ billsAtHigh: true, payAtLow: false }), "Variable bills are counted at their recent high.");
  assert.equal(cautionLine({ billsAtHigh: false, payAtLow: true }), "Variable pay is counted at its recent low.");
  assert.equal(
    cautionLine({ billsAtHigh: true, payAtLow: true }),
    "Variable bills are counted at their recent high, and variable pay at its recent low.",
  );
});

// ---------------------------------------------------------------------------
// Why the figure is what it is (docs/Safe-to-Spend-Why.md)
// ---------------------------------------------------------------------------

const named = (n: number) => formatDateWithWeekday(day(n));

test("why: one payment sets the tightest day; anything after it, up to the room, leaves the figure", () => {
  // 1000 - 600 on day 3, pay the same day: the 11 November shape.
  const why = whyThisNumber(run([once("Expense", "Visa payment", 600, 3), once("Income", "Pay", 2000, 3)], 1000));
  assert.equal(named(3), "Sunday 4 October");
  assert.deepEqual(why, {
    cause: "Your tightest day is Sunday 4 October, after Visa payment comes out.",
    consequence: "Anything dated after Sunday 4 October leaves this figure as it is, up to $2,000.00 in total.",
  });
});

test("why: several payments on the tightest day -> the two largest named, the rest counted", () => {
  const why = whyThisNumber(
    run(
      [
        once("Expense", "Phone", 50, 3),
        once("Expense", "Rent", 500, 3),
        once("Expense", "Gym", 30, 3),
        once("Expense", "Car", 200, 3),
        once("Income", "Pay", 2000, 3),
      ],
      1000,
    ),
  );
  assert.equal(why.cause, `Your tightest day is ${named(3)}, after Rent, Car and 2 more come out.`);
});

test("why: two payments -> both named", () => {
  const why = whyThisNumber(
    run([once("Expense", "Rent", 500, 3), once("Expense", "Car", 200, 3), once("Income", "Pay", 2000, 3)], 1000),
  );
  assert.equal(why.cause, `Your tightest day is ${named(3)}, after Rent and Car come out.`);
});

test("why: pay lands later -> everything until the payday counts in full, then the room", () => {
  const why = whyThisNumber(run([once("Expense", "Rent", 600, 3), once("Income", "Pay", 2000, 5)], 1000));
  assert.equal(
    why.consequence,
    `Anything dated through ${named(5)} comes off this figure in full. After that, up to $2,000.00 in total leaves it as it is.`,
  );
});

test("why: tightest day today with nothing ahead going lower -> 'today', never a date", () => {
  const why = whyThisNumber(run([once("Income", "Pay", 500, 0)], 1000));
  assert.deepEqual(why, {
    cause: "Today is your tightest day. Nothing ahead takes your balance below where it is now.",
    consequence: "Anything dated after today leaves this figure as it is, up to $500.00 in total.",
  });
});

test("why: an overdue bill moved to today -> 'Today is your tightest day, after ...'", () => {
  const why = whyThisNumber(run([once("Expense", "Rent", 300, -3), once("Income", "Pay", 1000, 0)], 1000));
  assert.equal(why.cause, "Today is your tightest day, after Rent comes out.");
});

test("why: no recovery inside the window -> everything through its end counts in full", () => {
  const result = run([once("Expense", "Rent", 300, 3)], 1000);
  assert.equal(result.after, null);
  assert.equal(
    whyThisNumber(result).consequence,
    `Anything dated through ${formatDateWithWeekday(result.horizonEnd)} comes off this figure in full.`,
  );
});

test("why: a $0 figure -> the cause only", () => {
  const result = run([once("Expense", "Rent", 900, 3), once("Income", "Pay", 2000, 3)], 1000);
  assert.equal(result.safeToSpend, 0);
  assert.equal(whyThisNumber(result).consequence, null);
  assert.equal(whyThisNumber(result).cause, `Your tightest day is ${named(3)}, after Rent comes out.`);
});

test("clear line with no cushion -> 'below zero'", () => {
  const result = run([once("Income", "Pay", 500, 5)], 1000, 0);
  assert.equal(
    (whatsAhead(result) as { line: string }).line,
    "No tight days in the next five weeks. Your lowest point, $1,000.00 today, doesn't go below zero.",
  );
});

test("clear line names a later low point by weekday and date", () => {
  const result = run([once("Expense", "Rent", 200, 3), once("Income", "Pay", 500, 3)], 1000);
  assert.equal(
    (whatsAhead(result) as { line: string }).line,
    `No tight days in the next five weeks. Your lowest point, $800.00 on ${named(3)}, doesn't go below your $300.00 cushion.`,
  );
});

// After a save -------------------------------------------------------------

// $1,000 cash, $100 cushion. Tightest day is day 3: the payment, then pay
// the same day. The saved row is a $300 checking expense on day 10 unless
// a test says otherwise.
function savedInput(saved: Partial<ProjectionTransaction> = {}) {
  const row: ProjectionTransaction = {
    transactionId: "saved",
    name: "New",
    kind: "Expense",
    fromAccountType: "Checking",
    toAccountType: null,
    fromCountsLater: true,
    toCountsLater: false,
    amount: 300,
    date: day(10),
    ...saved,
  };
  return {
    today: TODAY,
    cash: 1000,
    cushion: 100,
    goalHolds: [],
    schedules: [once("Expense", "Visa payment", 600, 3), once("Income", "Pay", 2000, 3)],
    futureTransactions: [row],
    holidays: new Set<string>(),
    fallbackWindowEnd: "2026-10-31",
  };
}

const withSaved = (saved: Partial<ProjectionTransaction>) => projectSafeToSpend(savedInput(saved));

test("after a save: a checking expense after the tightest day -> the note, naming that day", () => {
  assert.equal(
    figureUnchangedNote(withSaved({ amount: 300, date: day(10) }), ["saved"]),
    `Saved. This doesn't change your safe-to-spend figure — your tightest day is ${named(3)}, before this.`,
  );
});

test("after a save: on or before the tightest day -> no note", () => {
  assert.equal(figureUnchangedNote(withSaved({ amount: 300, date: day(3) }), ["saved"]), null);
  assert.equal(figureUnchangedNote(withSaved({ amount: 300, date: day(2) }), ["saved"]), null);
});

test("after a save: big enough to make a new, later tightest day -> no note", () => {
  // 2400 - 2500 on day 10 goes below the day-3 low of 400: it moved the figure.
  assert.equal(figureUnchangedNote(withSaved({ amount: 2500, date: day(10) }), ["saved"]), null);
});

test("after a save: not counted as an outflow -> no note", () => {
  // Credit card purchase: the card payment carries it, not this row.
  assert.equal(figureUnchangedNote(withSaved({ amount: 300, date: day(10), fromAccountType: "Credit Card" }), ["saved"]), null);
  // Savings: not spendable.
  assert.equal(figureUnchangedNote(withSaved({ amount: 300, date: day(10), fromAccountType: "Savings" }), ["saved"]), null);
  // Income.
  assert.equal(figureUnchangedNote(withSaved({ amount: 300, date: day(10), kind: "Income" }), ["saved"]), null);
  // Not the saved row.
  assert.equal(figureUnchangedNote(withSaved({ amount: 300, date: day(10) }), ["other"]), null);
});

test("after a save: a $0 figure -> no note", () => {
  const result = projectSafeToSpend({ ...savedInput(), cushion: 5000 });
  assert.equal(result.safeToSpend, 0);
  assert.equal(figureUnchangedNote(result, ["saved"]), null);
});

test("after a save: a transfer out of the set is matched by its Expense leg", () => {
  const result = withSaved({ transactionId: "leg", kind: "Transfer", toAccountType: "Savings" });
  assert.match(figureUnchangedNote(result, ["leg", "other-leg"]) ?? "", /^Saved\. This doesn't change/);
});
