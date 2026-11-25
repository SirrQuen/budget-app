import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDashboardRange } from "./dashboardRange";
import { todayInZone } from "./date";
import { summarizeFlow, topCategories } from "./flowSummary";
import fixtures from "./flowScope.fixtures.json";
import { rangeCashflowStats } from "./rangeCashflow";
import {
  activeFlowScope,
  budgetDrillMonth,
  buildListHref,
  flowCategoryHref,
  flowDrillHref,
  inFlowScope,
  listReadOptions,
  parseTransactionFilters,
  periodForRange,
  periodLabels,
  periodSpan,
  type Flow,
} from "./transactionFilters";

// docs/Income-Spending-Drilldown.md: the tile's total == the drill-down's
// total == the sum of its category rows, to the cent. Pure: v_daily_cashflow
// is emulated here (no transfer legs, summed by day), and
// docs/flow-scope-test.sql checks the real view against the same scope.
//
// `tileBefore` in the fixtures is what getRangeCashflowStats() returned for
// these users on main, before the tiles moved onto the flow scope.

type Row = [date: string, type: string, amount: number, transferGroup: string | null, what: string, category: string | null];
type User = { zone: string; instant: string; rows: Row[] };
const USERS = fixtures.users as unknown as Record<string, User>;
const FLOWS: Flow[] = ["income", "spending"];
const RANGES: Record<string, Record<string, string>> = {
  mtd: {},
  "7d": { range: "7d" },
  "30d": { range: "30d" },
  "90d": { range: "90d" },
  custom: { from: "2026-10-01", to: "2026-11-30" },
};

const rowsOf = (u: User) =>
  u.rows.map(([transaction_date, transaction_type, amount, transfer_group_id, what, category]) => ({
    transaction_date,
    transaction_type,
    amount,
    transfer_group_id,
    what,
    category,
  }));

function dailyView(u: User) {
  const days = new Map<string, { income: number; expenses: number }>();
  for (const r of rowsOf(u)) {
    if (r.transfer_group_id !== null) continue;
    const day = days.get(r.transaction_date) ?? { income: 0, expenses: 0 };
    day[r.transaction_type === "Income" ? "income" : "expenses"] += Math.round(r.amount * 100);
    days.set(r.transaction_date, day);
  }
  return [...days].map(([day, c]) => ({ day, income: c.income / 100, expenses: c.expenses / 100 }));
}

const todayOf = (u: User) => todayInZone(u.zone, new Date(u.instant));

test("the tiles read as they did before, for every fixture user and range", () => {
  const seen: Record<string, unknown> = {};
  for (const [name, u] of Object.entries(USERS)) {
    const today = todayOf(u);
    for (const [label, params] of Object.entries(RANGES)) {
      seen[`${name} ${label} ${today}`] = rangeCashflowStats(dailyView(u), resolveDashboardRange(params, today));
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(seen)), fixtures.tileBefore);
});

test("tile total == drill-down total == sum of category rows, to the cent", () => {
  for (const [name, u] of Object.entries(USERS)) {
    const today = todayOf(u);
    for (const [label, params] of Object.entries(RANGES)) {
      const range = resolveDashboardRange(params, today);
      const tile = rangeCashflowStats(dailyView(u), range);
      for (const flow of FLOWS) {
        // The round trip a tap makes: link -> URL -> filters -> scope.
        const url = new URL(flowDrillHref(flow, periodForRange(range)), "http://x");
        const filters = parseTransactionFilters(Object.fromEntries(url.searchParams));
        const scope = activeFlowScope(filters, today)!;
        assert.deepEqual([scope.dateFrom, scope.dateTo], [range.from, range.to], `${name} ${label} ${flow}`);

        const listed = rowsOf(u).filter((r) => inFlowScope(r, scope));
        const summary = summarizeFlow(
          listed.map((r) => ({ amount: r.amount, categoryid: r.category, categoryName: r.category })),
        );
        const cents = Math.round(tile[flow].value * 100);
        assert.equal(summary.cents, cents, `${name} ${label} ${flow} total`);
        assert.equal(summary.count, listed.length);
        assert.equal(summary.categories.reduce((s, c) => s + c.cents, 0), cents, `${name} ${label} ${flow} rows`);
        for (const limit of [5, 8, 1]) {
          const { top, otherCents } = topCategories(summary.categories, limit);
          assert.equal(top.reduce((s, c) => s + c.cents, 0) + (otherCents ?? 0), cents);
        }
      }
    }
  }
});

test("a category row opens this drill-down narrowed to it, and the list adds up to the row, to the cent", () => {
  for (const [name, u] of Object.entries(USERS)) {
    const today = todayOf(u);
    // The fixtures name categories rather than id them; the URL needs a uuid.
    const names = [...new Set(rowsOf(u).flatMap((r) => (r.category ? [r.category] : [])))];
    const idOf = new Map(names.map((n, i) => [n, `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`]));
    const rows = rowsOf(u).map((r) => ({ ...r, categoryid: r.category ? idOf.get(r.category)! : null }));
    const toFlowRow = (r: (typeof rows)[number]) => ({
      amount: r.amount,
      categoryid: r.categoryid,
      categoryName: r.category,
    });

    for (const [label, params] of Object.entries(RANGES)) {
      const period = periodForRange(resolveDashboardRange(params, today));
      for (const flow of FLOWS) {
        const scope = activeFlowScope({ flow, period }, today)!;
        const summary = summarizeFlow(rows.filter((r) => inFlowScope(r, scope)).map(toFlowRow));
        for (const category of summary.categories) {
          const url = new URL(flowCategoryHref(category.categoryid!, flow, period), "http://x");
          const filters = parseTransactionFilters(Object.fromEntries(url.searchParams));
          const where = `${name} ${label} ${flow} ${category.name}`;
          assert.deepEqual([filters.flow, filters.period, filters.categoryid], [flow, period, category.categoryid], where);

          // What the narrowed list reads (listReadOptions), applied to the rows.
          const read = listReadOptions(filters, today);
          assert.equal(read.excludeTransfers, true, where);
          const listed = rows.filter(
            (r) =>
              r.transfer_group_id === null &&
              r.transaction_type === read.transaction_type &&
              r.transaction_date >= read.dateFrom! &&
              r.transaction_date <= read.dateTo! &&
              r.categoryid === read.categoryid,
          );
          assert.equal(summarizeFlow(listed.map(toFlowRow)).cents, category.cents, where);
        }
      }
    }
  }
});

test("what's in each scope: transfers out; goal money, refunds, archived and imported rows in", () => {
  const u = USERS.newyork;
  const today = todayOf(u);
  const listed = (flow: Flow) =>
    rowsOf(u)
      .filter((r) => inFlowScope(r, activeFlowScope({ flow, period: "2026-11" }, today)!))
      .map((r) => r.what);
  assert.deepEqual(listed("income"), ["pay", "pay", "refund"]);
  assert.deepEqual(listed("spending"), [
    "rent",
    "coffee",
    "coffee",
    "goal linked",
    "archived account",
    "imported",
    "23:30 last day",
  ]);
});

test("23:30 on the last day of the month is in that month, in the user's zone, not UTC's", () => {
  // 2026-11-30 23:30 in New York is already December in UTC.
  assert.equal(todayInZone("America/New_York", new Date("2026-12-01T04:30:00Z")), "2026-11-30");
  // 2026-11-30 23:30 in Auckland.
  assert.equal(todayInZone("Pacific/Auckland", new Date("2026-11-30T10:30:00Z")), "2026-11-30");
  for (const name of ["newyork", "auckland"]) {
    const u = USERS[name];
    const scope = activeFlowScope({ flow: "spending", period: "2026-11" }, todayOf(u))!;
    assert.equal(scope.dateTo, "2026-11-30", name);
    const what = rowsOf(u).filter((r) => inFlowScope(r, scope)).map((r) => r.what);
    assert.ok(what.includes("23:30 last day"), name);
    assert.ok(!what.includes("next month"), name);
  }
});

test("a month runs to today while it's going, and in full afterwards", () => {
  assert.deepEqual(periodSpan("2026-11", "2026-11-25"), { from: "2026-11-01", to: "2026-11-25" });
  assert.deepEqual(periodSpan("2026-11", "2026-12-01"), { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(periodSpan("2026-02", "2027-01-01"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(periodSpan("2026-10-27..2026-11-25", "2026-12-09"), { from: "2026-10-27", to: "2026-11-25" });
});

test("flow and period come together or not at all, and fix the direction", () => {
  const parse = parseTransactionFilters;
  for (const bad of [
    { flow: "spending" },
    { period: "2026-11" },
    { flow: "transfers", period: "2026-11" },
    { flow: "income", period: "2026-13" },
    { flow: "income", period: "2026-02-30..2026-03-01" },
    { flow: "income", period: "2026-11-02..2026-11-01" },
  ]) {
    const f = parse(bad);
    assert.deepEqual([f.flow, f.period], ["", ""], JSON.stringify(bad));
  }
  assert.equal(parse({ flow: "spending", period: "2026-11", type: "Income" }).type, "");
});

test("other filters only narrow the scope; the list never reads a transfer leg", () => {
  const f = parseTransactionFilters({ flow: "spending", period: "2026-11", dateFrom: "2026-10-01", dateTo: "2026-11-10", q: "rent" });
  assert.deepEqual(listReadOptions(f, "2026-11-25"), {
    dateFrom: "2026-11-01",
    dateTo: "2026-11-10",
    transaction_type: "Expense",
    excludeTransfers: true,
    q: "rent",
  });
  // Without a flow it's the filters as they are.
  assert.deepEqual(listReadOptions(parseTransactionFilters({ type: "Income" }), "2026-11-25"), { transaction_type: "Income" });
});

test("a flow's URL keeps it through paging, and is never mistaken for a budget's drill-down", () => {
  assert.equal(flowDrillHref("spending", "2026-11"), "/transactions?flow=spending&period=2026-11");
  const f = parseTransactionFilters({ flow: "spending", period: "2026-11" });
  assert.equal(buildListHref("/transactions", f, { page: "2" }), "/transactions?flow=spending&period=2026-11&page=2");
  const id = "11111111-1111-4111-8111-111111111111";
  const both = parseTransactionFilters({
    flow: "spending",
    period: "2026-11",
    categoryid: id,
    dateFrom: "2026-11-01",
    dateTo: "2026-11-30",
  });
  assert.equal(budgetDrillMonth(both), null);
});

test("a category link keeps the flow and period, and isn't a budget's drill-down", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const href = flowCategoryHref(id, "spending", "2026-11");
  assert.equal(href, `/transactions?flow=spending&period=2026-11&categoryid=${id}`);
  assert.equal(budgetDrillMonth(parseTransactionFilters(Object.fromEntries(new URL(href, "http://x").searchParams))), null);
});

test("period labels name the month, or the days, and the year only when it isn't this one", () => {
  assert.deepEqual(periodLabels("2026-11", "2026-11-25"), { short: "November", phrase: "in November" });
  assert.equal(periodLabels("2026-11", "2027-01-03").phrase, "in November 2026");
  assert.deepEqual(periodLabels("2026-10-27..2026-11-25", "2026-11-25"), {
    short: "27 Oct – 25 Nov",
    phrase: "from 27 Oct to 25 Nov",
  });
});
