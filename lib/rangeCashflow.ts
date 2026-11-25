import { addDaysISO } from "@/lib/date";
import type { DashboardRange } from "@/lib/dashboardRange";
import { flowScope, type Flow } from "@/lib/transactionFilters";

// The Income and Spending tiles' arithmetic, pure: v_daily_cashflow's rows
// in, the totals, deltas and sparklines out. getRangeCashflowStats()
// (lib/db/dashboard.ts) reads the rows.

export type DashboardStat = {
  /** The headline figure -- as-of-now for net worth, range total for cashflow. */
  value: number;
  /**
   * Sparkline points, oldest first, the last being the most recent bucket.
   * Dollars. 12 monthly points for net worth; range-bucketed for the
   * cashflow tiles.
   */
  points: number[];
  /** value minus the comparison figure (prior month, or preceding window). Dollars, signed. */
  delta: number;
};

export type RangeCashflowStats = {
  income: DashboardStat;
  spending: DashboardStat;
};

export type DailyCashflow = { day: string | null; income: number | null; expenses: number | null };

// Every figure is summed off the daily grid in integer cents (amount is exact
// `numeric`). The view only has rows for days with activity, so a missing day
// is a real zero.
export function rangeCashflowStats(data: readonly DailyCashflow[], range: DashboardRange): RangeCashflowStats {
  const toCents = (n: number | null | undefined) => Math.round((n ?? 0) * 100);
  const byDay = new Map(data.map((r) => [r.day, r]));

  // Sum an inclusive [from, to] span off the daily grid, in cents. ISO
  // "YYYY-MM-DD" strings compare lexicographically, so the loop bound is safe.
  const sumSpan = (from: string, to: string, key: "income" | "expenses") => {
    let cents = 0;
    for (let d = from; d <= to; d = addDaysISO(d, 1)) {
      cents += toCents(byDay.get(d)?.[key]);
    }
    return cents;
  };

  // Bucket start dates across the selected range, per range.bucket.
  const bucketStarts: string[] = [];
  if (range.bucket === "month") {
    let d = `${range.from.slice(0, 7)}-01`;
    while (d <= range.to) {
      bucketStarts.push(d < range.from ? range.from : d);
      const [y, m] = d.split("-").map(Number);
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      d = `${ny}-${String(nm).padStart(2, "0")}-01`;
    }
  } else {
    const step = range.bucket === "week" ? 7 : 1;
    for (let d = range.from; d <= range.to; d = addDaysISO(d, step)) {
      bucketStarts.push(d);
    }
  }

  const stat = (flow: Flow): DashboardStat => {
    // The headline is the flow scope's total: the drill-down lists the same.
    const scope = flowScope(flow, range);
    const valueCents = sumSpan(scope.dateFrom, scope.dateTo, scope.column);
    const prevCents = sumSpan(range.prevFrom, range.prevTo, scope.column);
    const points = bucketStarts.map((start, i) => {
      const end =
        i + 1 < bucketStarts.length ? addDaysISO(bucketStarts[i + 1], -1) : range.to;
      return sumSpan(start, end, scope.column) / 100;
    });
    return { value: valueCents / 100, points, delta: (valueCents - prevCents) / 100 };
  };

  return { income: stat("income"), spending: stat("spending") };
}
