import { test } from "node:test";
import assert from "node:assert/strict";
import {
  categoryGroupKey,
  choiceToCountsDespiteAnchor,
  findDuplicates,
  matchCategories,
  summarizeImport,
  type DateTreatment,
  type ExistingTransaction,
} from "./importReview";

const existing = (id: string, date: string, cents: number): ExistingTransaction => ({
  id,
  date,
  cents,
  description: "x",
  type: "Expense",
});

// ---- duplicates ----------------------------------------------------

test("a row is flagged by amount and a date within three days", () => {
  const found = findDuplicates(
    [
      { row: 2, date: "2026-11-05", cents: 575 },
      { row: 3, date: "2026-11-05", cents: 576 }, // other amount
      { row: 4, date: "2026-11-09", cents: 575 }, // four days
      { row: 5, date: "2026-11-08", cents: 575 }, // three days: inside
    ],
    [existing("a", "2026-11-05", 575)],
  );
  assert.deepEqual([...found.keys()], [2, 5]);
  assert.equal(found.get(2)?.gapDays, 0);
  assert.equal(found.get(5)?.gapDays, 3);
});

test("rows within the file are never flagged against each other", () => {
  const found = findDuplicates(
    [
      { row: 2, date: "2026-11-05", cents: 575 },
      { row: 3, date: "2026-11-05", cents: 575 },
    ],
    [],
  );
  assert.equal(found.size, 0);
});

test("the closest existing transaction is the one shown, the earlier on a tie", () => {
  const found = findDuplicates(
    [{ row: 2, date: "2026-11-05", cents: 575 }],
    [existing("far", "2026-11-07", 575), existing("near-late", "2026-11-06", 575), existing("near-early", "2026-11-04", 575)],
  );
  assert.equal(found.get(2)?.existing.id, "near-early");
});

test("importing the same file twice flags every row on the second pass", () => {
  const rows = Array.from({ length: 140 }, (_, i) => ({
    row: i + 2,
    date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`,
    cents: 100 + i,
  }));
  assert.equal(findDuplicates(rows, []).size, 0);
  const afterFirst = rows.map((r, i) => existing(`e${i}`, r.date, r.cents));
  assert.equal(findDuplicates(rows, afterFirst).size, 140);
});

// ---- categories ----------------------------------------------------

const cats = [
  { id: "g", name: "Groceries", type: "Expense" as const },
  { id: "p", name: "Pay", type: "Income" as const },
  { id: "d1", name: "Dining", type: "Expense" as const },
  { id: "d2", name: "dining", type: "Expense" as const },
  { id: "gi", name: "Gifts", type: "Income" as const },
];

test("categories match by name, ignoring case, within the row's own type", () => {
  const m = matchCategories(
    [
      { row: 2, type: "Expense", categoryName: "  groceries " },
      { row: 3, type: "Income", categoryName: "PAY" },
      { row: 4, type: "Expense", categoryName: "Pay" }, // Pay is an Income category
    ],
    cats,
  );
  assert.deepEqual([...m.byRow.entries()], [[2, "g"], [3, "p"]]);
  assert.deepEqual(m.unmatched.map((g) => [g.type, g.name, g.count]), [["Expense", "Pay", 1]]);
});

test("a name two categories share is unmatched -- never guessed between", () => {
  const m = matchCategories([{ row: 2, type: "Expense", categoryName: "Dining" }], cats);
  assert.equal(m.byRow.size, 0);
  assert.deepEqual(m.unmatched.map((g) => [g.name, g.count]), [["Dining", 1]]);
  assert.equal(m.unresolved.length, 1);
});

test("unmatched names are grouped and counted, most first; a missing name is its own group", () => {
  const m = matchCategories(
    [
      { row: 2, type: "Expense", categoryName: "Gas" },
      { row: 3, type: "Expense", categoryName: "gas" },
      { row: 4, type: "Expense", categoryName: "Fees" },
      { row: 5, type: "Expense", categoryName: "Gas" },
      { row: 6, type: "Expense", categoryName: null },
      { row: 7, type: "Income", categoryName: "  " },
    ],
    cats,
  );
  assert.deepEqual(m.unmatched.map((g) => [g.name, g.type, g.count]), [
    ["Gas", "Expense", 3],
    ["Fees", "Expense", 1],
    [null, "Expense", 1],
    [null, "Income", 1],
  ]);
});

test("the database needs a category on every row, so each unmatched group needs one chosen", () => {
  const rows = [
    { row: 2, type: "Expense" as const, categoryName: "Gas" },
    { row: 3, type: "Expense" as const, categoryName: "gas" },
    { row: 4, type: "Expense" as const, categoryName: "Groceries" },
    { row: 5, type: "Expense" as const, categoryName: null },
  ];
  const before = matchCategories(rows, cats);
  assert.deepEqual(before.unresolved.map((g) => g.name), ["Gas", null]);
  assert.equal(before.byRow.has(2), false); // nothing is put anywhere on the person's behalf

  const gasKey = categoryGroupKey("Expense", "Gas");
  const partway = matchCategories(rows, cats, new Map([[gasKey, "d1"]]));
  assert.deepEqual([...partway.byRow.entries()], [[4, "g"], [2, "d1"], [3, "d1"]]);
  assert.deepEqual(partway.unresolved.map((g) => g.name), [null]);

  const done = matchCategories(rows, cats, new Map([[gasKey, "d1"], [categoryGroupKey("Expense", null), "g"]]));
  assert.equal(done.unresolved.length, 0);
  assert.equal(done.byRow.size, 4);
});

// ---- the preview's figures -----------------------------------------

const T = new Map<string, DateTreatment>([
  ["2026-11-10", { treatment: "counts", countsIfIncluded: true, countsIfAdded: true }],
  ["2026-10-01", { treatment: "before_anchor", countsIfIncluded: false, countsIfAdded: true }],
  ["2026-12-01", { treatment: "future", countsIfIncluded: false, countsIfAdded: false }],
]);

const ROWS = [
  { date: "2026-11-10", cents: 10000, type: "Expense" as const },
  { date: "2026-11-10", cents: 25000, type: "Income" as const },
  { date: "2026-10-01", cents: 4000, type: "Expense" as const },
  { date: "2026-10-01", cents: 1000, type: "Income" as const },
  { date: "2026-12-01", cents: 999, type: "Expense" as const },
];

test("the sums are integer cents, spent and received apart", () => {
  const s = summarizeImport(ROWS, T, "included");
  assert.equal(s.count, 5);
  assert.equal(s.spentCount, 3);
  assert.equal(s.spentCents, 10000 + 4000 + 999);
  assert.equal(s.receivedCount, 2);
  assert.equal(s.receivedCents, 26000);
  assert.equal(Number.isInteger(s.balanceChangeCents), true);
});

test('"Yes, already counted": rows before the balance date change nothing', () => {
  const s = summarizeImport(ROWS, T, "included");
  assert.equal(s.balanceChangeCents, 25000 - 10000); // only the row that counts by date
  assert.equal(s.beforeAnchorCount, 2);
  assert.equal(s.futureCount, 1);
  assert.equal(s.answerNeeded, false);
});

test('"No, add them to my balance": moves it by exactly those rows, once', () => {
  const yes = summarizeImport(ROWS, T, "included");
  const no = summarizeImport(ROWS, T, "added");
  assert.equal(no.balanceChangeCents - yes.balanceChangeCents, 1000 - 4000);
});

test("before an answer, those rows count for nothing and the answer is flagged as needed", () => {
  const s = summarizeImport(ROWS, T, null);
  assert.equal(s.answerNeeded, true);
  assert.equal(s.balanceChangeCents, 25000 - 10000);
  assert.equal(summarizeImport(ROWS.slice(0, 2), T, null).answerNeeded, false);
});

test("a date the database hasn't described is never counted", () => {
  const s = summarizeImport([{ date: "2026-01-01", cents: 500, type: "Income" }], T, "added");
  assert.equal(s.undescribed, 1);
  assert.equal(s.balanceChangeCents, 0);
});

test("the answer reaches the database as it expects it", () => {
  assert.equal(choiceToCountsDespiteAnchor("added"), true);
  assert.equal(choiceToCountsDespiteAnchor("included"), false);
  assert.equal(choiceToCountsDespiteAnchor(null), null);
});
