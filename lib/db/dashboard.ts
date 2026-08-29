import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { todayISO, addDaysISO, endOfMonthISO, daysBetweenInclusive } from "@/lib/date";

type DashboardKpisRow = Database["public"]["Views"]["v_dashboard_kpis"]["Row"];
type NetWorthRow = Database["public"]["Views"]["v_net_worth"]["Row"];
type MonthlyCashflowRow = Database["public"]["Views"]["v_monthly_cashflow"]["Row"];
type DailyCashflowRow = Database["public"]["Views"]["v_daily_cashflow"]["Row"];
type CategorySpendingRow = Database["public"]["Views"]["v_category_spending"]["Row"];
type GoalProgressRow = Database["public"]["Views"]["v_goal_progress"]["Row"];
type GoalsSummaryRow = Database["public"]["Views"]["v_goals_summary"]["Row"];
type UpcomingRecurringRow = Database["public"]["Views"]["v_upcoming_recurring"]["Row"];
type IntegrityIssueRow = Database["public"]["Views"]["v_integrity_issues"]["Row"];
type InvestmentHoldingRow = Database["public"]["Views"]["v_investment_holdings"]["Row"];
type PortfolioSummaryRow = Database["public"]["Views"]["v_portfolio_summary"]["Row"];

export type DbResult<T> = { data: T; error: null } | { data: null; error: string };

// One row per user, pinned to the current calendar month server-side --
// there's no month param to pass. If a date-pickable dashboard shows up,
// this view needs to become a ranged function (see DATABASE.md).
export async function getDashboardKpis(): Promise<DbResult<DashboardKpisRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase.from("v_dashboard_kpis").select("*").single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

// Point-in-time snapshot, one row per user -- no date range applies.
//
// maybeSingle(), not single(): v_net_worth is `group by userid` over active
// accounts, so a user with zero active accounts gets zero rows, not a
// zero-valued row. That's a normal state, not an error.
export async function getNetWorth(): Promise<DbResult<NetWorthRow | null>> {
  const supabase = await createClient();

  const { data, error } = await supabase.from("v_net_worth").select("*").maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export type GetMonthlyCashflowOptions = {
  monthFrom?: string;
  monthTo?: string;
};

export async function getMonthlyCashflow(
  opts: GetMonthlyCashflowOptions = {},
): Promise<DbResult<MonthlyCashflowRow[]>> {
  const supabase = await createClient();

  let query = supabase
    .from("v_monthly_cashflow")
    .select("*")
    .order("month", { ascending: true });

  if (opts.monthFrom) {
    query = query.gte("month", opts.monthFrom);
  }
  if (opts.monthTo) {
    query = query.lte("month", opts.monthTo);
  }

  const { data, error } = await query;

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export type GetDailyCashflowOptions = {
  dateFrom?: string;
  dateTo?: string;
};

// running_net is cumulative over the user's whole history, not just the
// filtered range -- a range here narrows which days come back, not what
// running_net means for them.
export async function getDailyCashflow(
  opts: GetDailyCashflowOptions = {},
): Promise<DbResult<DailyCashflowRow[]>> {
  const supabase = await createClient();

  let query = supabase
    .from("v_daily_cashflow")
    .select("*")
    .order("day", { ascending: true });

  if (opts.dateFrom) {
    query = query.gte("day", opts.dateFrom);
  }
  if (opts.dateTo) {
    query = query.lte("day", opts.dateTo);
  }

  const { data, error } = await query;

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export type GetCategorySpendingOptions = {
  monthFrom?: string;
  monthTo?: string;
};

export async function getCategorySpending(
  opts: GetCategorySpendingOptions = {},
): Promise<DbResult<CategorySpendingRow[]>> {
  const supabase = await createClient();

  let query = supabase
    .from("v_category_spending")
    .select("*")
    .order("month", { ascending: false })
    .order("total_spend", { ascending: false });

  if (opts.monthFrom) {
    query = query.gte("month", opts.monthFrom);
  }
  if (opts.monthTo) {
    query = query.lte("month", opts.monthTo);
  }

  const { data, error } = await query;

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export type Movement = {
  id: string;
  name: string;
  /** This month's spend, dollars. */
  current: number;
  /** Average monthly spend over the prior three calendar months, dollars. */
  baseline: number;
  /** (current - baseline) / baseline -- signed. 0.34 reads as "up 34%". */
  pctChange: number;
};

export type GroupMovement = Movement & {
  /** Active categories in this group that have a baseline, biggest mover first. */
  categories: Movement[];
};

export type GroupMovementResult = {
  /** Every group with a trailing baseline, largest absolute mover first. */
  groups: GroupMovement[];
  /**
   * The one group worth a sentence -- it clears both a percentage and a
   * dollar floor. null is a real answer: a quiet month.
   */
  topMover: GroupMovement | null;
};

// A mover must clear both floors: a big percentage on a trivial base
// ($2 -> $3) is noise, and a big dollar swing that's small against the base
// isn't really a move.
const MOVER_MIN_PCT = 0.15;
const MOVER_MIN_DOLLARS = 25;

// This month's spend per category group, against that group's own average
// over the prior three calendar months, ranked by how far it moved.
//
// v_category_spending is Expense-only and already drops transfer legs; it
// carries no is_active flag, so inactive categories are filtered out here
// against the categories table. Group totals sum their categories -- cents
// math, never JS floats (amount is exact numeric).
//
// "This month" is the raw month-to-date figure, like every other
// current-month number on the dashboard. Early in the month most groups
// read low; the dollar floor and the quiet-month fallback absorb that
// rather than surfacing a false "everything is down".
export async function getGroupMovement(): Promise<DbResult<GroupMovementResult>> {
  const supabase = await createClient();

  // months[0..2] are the trailing three; months[3] is the current month.
  const now = new Date();
  const months = [3, 2, 1, 0].map((back) => {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const currentMonth = months[3];

  const [spendRes, activeRes] = await Promise.all([
    supabase
      .from("v_category_spending")
      .select("month, group_id, group_name, category_id, category_name, total_spend")
      .gte("month", months[0])
      .lte("month", currentMonth),
    supabase.from("categories").select("id").eq("is_active", true),
  ]);

  if (spendRes.error) {
    return { data: null, error: spendRes.error.message };
  }
  if (activeRes.error) {
    return { data: null, error: activeRes.error.message };
  }

  const activeIds = new Set(activeRes.data.map((row) => row.id));

  type Acc = { name: string; currentCents: number; trailingCents: number };
  type GroupAcc = Acc & { cats: Map<string, Acc> };
  const groups = new Map<string, GroupAcc>();

  for (const row of spendRes.data) {
    if (!row.group_id || !row.category_id || !activeIds.has(row.category_id)) {
      continue;
    }

    let group = groups.get(row.group_id);
    if (!group) {
      group = { name: row.group_name ?? "", currentCents: 0, trailingCents: 0, cats: new Map() };
      groups.set(row.group_id, group);
    }

    let cat = group.cats.get(row.category_id);
    if (!cat) {
      cat = { name: row.category_name ?? "", currentCents: 0, trailingCents: 0 };
      group.cats.set(row.category_id, cat);
    }

    const cents = Math.round((row.total_spend ?? 0) * 100);
    const bucket = row.month === currentMonth ? "currentCents" : "trailingCents";
    cat[bucket] += cents;
    group[bucket] += cents;
  }

  // A movement needs a non-zero baseline; without one there's no percentage
  // to rank by (that's "new spending", a different story).
  const toMovement = (id: string, acc: Acc): Movement | null => {
    const baselineCents = acc.trailingCents / 3;
    if (baselineCents <= 0) {
      return null;
    }
    return {
      id,
      name: acc.name,
      current: acc.currentCents / 100,
      baseline: baselineCents / 100,
      pctChange: (acc.currentCents - baselineCents) / baselineCents,
    };
  };

  const byAbsPct = (a: Movement, b: Movement) => Math.abs(b.pctChange) - Math.abs(a.pctChange);

  const groupMovements: GroupMovement[] = [];
  for (const [id, group] of groups) {
    const gm = toMovement(id, group);
    if (!gm) {
      continue;
    }
    const categories = [...group.cats]
      .map(([catId, cat]) => toMovement(catId, cat))
      .filter((m): m is Movement => m !== null)
      .sort(byAbsPct);
    groupMovements.push({ ...gm, categories });
  }

  groupMovements.sort(byAbsPct);

  const topMover =
    groupMovements.find(
      (g) =>
        Math.abs(g.pctChange) >= MOVER_MIN_PCT &&
        Math.abs(g.current - g.baseline) >= MOVER_MIN_DOLLARS,
    ) ?? null;

  return { data: { groups: groupMovements, topMover }, error: null };
}

// target_date/last_contribution_date describe each goal, not a bucketed
// series -- there's no meaningful range filter here, unlike the cashflow
// views above.
export async function getGoalProgress(): Promise<DbResult<GoalProgressRow[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("v_goal_progress")
    .select("*")
    .order("target_date", { ascending: true, nullsFirst: false });

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

// One row per user, aggregating active goals -- no date range applies.
//
// maybeSingle(), not single(): v_goals_summary is `group by userid` over
// v_goal_progress, so a user with no goals yet gets zero rows, not a
// zero-valued row. That's a normal state, not an error.
export async function getGoalsSummary(): Promise<DbResult<GoalsSummaryRow | null>> {
  const supabase = await createClient();

  const { data, error } = await supabase.from("v_goals_summary").select("*").maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export type GetUpcomingRecurringOptions = {
  dateFrom?: string;
  dateTo?: string;
};

export async function getUpcomingRecurring(
  opts: GetUpcomingRecurringOptions = {},
): Promise<DbResult<UpcomingRecurringRow[]>> {
  const supabase = await createClient();

  let query = supabase
    .from("v_upcoming_recurring")
    .select("*")
    .order("next_run_date", { ascending: true });

  if (opts.dateFrom) {
    query = query.gte("next_run_date", opts.dateFrom);
  }
  if (opts.dateTo) {
    query = query.lte("next_run_date", opts.dateTo);
  }

  const { data, error } = await query;

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export type CashflowPoint = {
  /** "YYYY-MM-DD", local calendar day. */
  day: string;
  income: number;
  expenses: number;
};

// A continuous daily series for the cashflow chart -- exactly `days` points
// ending today, one per calendar day. v_daily_cashflow only has rows for
// days with activity (see DATABASE.md), so the gaps are filled here with
// zeros: a time axis has to be continuous or the line lies about the dates
// between two sparse points. income/expenses are per-day figures the view
// already summed -- nothing is aggregated here, just placed on the grid.
export async function getCashflowChart(days = 90): Promise<DbResult<CashflowPoint[]>> {
  const supabase = await createClient();

  const today = todayISO();
  const from = addDaysISO(today, -(days - 1));

  const { data, error } = await supabase
    .from("v_daily_cashflow")
    .select("day, income, expenses")
    .gte("day", from)
    .lte("day", today)
    .order("day", { ascending: true });

  if (error) {
    return { data: null, error: error.message };
  }

  const byDay = new Map(data.map((row) => [row.day, row]));
  const points: CashflowPoint[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDaysISO(from, i);
    const row = byDay.get(day);
    points.push({ day, income: row?.income ?? 0, expenses: row?.expenses ?? 0 });
  }

  return { data: points, error: null };
}

export type LoggingStreak = {
  /** Consecutive days ending today or yesterday -- 0 once a day is missed. */
  current: number;
  /** Longest consecutive run found in the 90-day window, current included. */
  best: number;
  /** Whether today already has a logged transaction. */
  loggedToday: boolean;
};

function localISODate(d: Date): string {
  // Local calendar day, not UTC -- see AddTransactionForm's todayISO for why
  // the offset adjustment matters near midnight.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

// True when b is exactly the calendar day after a ("YYYY-MM-DD" strings).
// Epoch-math on Date.UTC is safe here since these are date-only values with
// no time-of-day or DST to account for.
function isNextCalendarDay(a: string, b: string): boolean {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad) === 86_400_000;
}

// Calendar day before `dateISO` ("YYYY-MM-DD"). Same UTC-epoch approach as
// isNextCalendarDay -- dateISO is already a plain calendar date with no
// time-of-day, so this stays pure and doesn't need to reason about DST.
function previousCalendarDay(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 86_400_000).toISOString().slice(0, 10);
}

// Pure so it's testable without a DB round trip. dates need not be sorted
// or deduped -- both happen here -- so callers can pass raw query results
// straight through. Multiple transactions on one day collapse to one day
// via the Set; a day with none simply isn't in `dates`, which is what
// breaks a run (isNextCalendarDay only holds for actual next-day pairs).
export function computeLoggingStreak(dates: string[], todayISO: string): LoggingStreak {
  const sorted = [...new Set(dates)].sort();

  let best = 0;
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i > 0 && isNextCalendarDay(sorted[i - 1], sorted[i]) ? run + 1 : 1;
    best = Math.max(best, run);
  }

  // Yesterday still counts as "current" so the streak doesn't visibly
  // break at 12:00am before the user has had a chance to log today.
  const yesterdayISO = previousCalendarDay(todayISO);
  const last = sorted[sorted.length - 1];

  let current = 0;
  if (last === todayISO || last === yesterdayISO) {
    current = 1;
    for (let i = sorted.length - 1; i > 0; i--) {
      if (isNextCalendarDay(sorted[i - 1], sorted[i])) {
        current += 1;
      } else {
        break;
      }
    }
  }

  return { current, best, loggedToday: last === todayISO };
}

// Dates only, no money -- streaks are computed in JS from distinct
// transaction_date values rather than a view, unlike every money figure
// elsewhere in this file. Never stored or incremented: recomputed from
// the transactions table on every read, so there's no counter to drift
// out of sync with reality.
export async function getLoggingStreak(): Promise<DbResult<LoggingStreak>> {
  const supabase = await createClient();

  const today = new Date();
  const since = new Date(today);
  since.setDate(since.getDate() - 90);

  const { data, error } = await supabase
    .from("transactions")
    .select("transaction_date")
    .gte("transaction_date", localISODate(since));

  if (error) {
    return { data: null, error: error.message };
  }

  const streak = computeLoggingStreak(
    data.map((row) => row.transaction_date),
    localISODate(today),
  );

  return { data: streak, error: null };
}

export type SafeToSpendCommitment = {
  recurringId: string;
  /** The recurring template's own description, shown verbatim in the breakdown. */
  name: string;
  /** Positive outflow amount, in dollars. */
  amount: number;
  /** next_run_date -- the day this commitment falls due. */
  dueDate: string;
};

export type SafeToSpend = {
  /**
   * Balance across asset accounts only -- Checking, Savings, Investment,
   * Cash. Never Credit Card or Loan. This is v_net_worth.total_assets,
   * which sums exactly those active account balances in SQL.
   */
  cashOnHand: number;
  /**
   * Recurring expense outflows whose next run falls between today and the
   * end of the current calendar month, inclusive, earliest first.
   */
  commitments: SafeToSpendCommitment[];
  /** Sum of every commitment amount. */
  committed: number;
  /**
   * cashOnHand minus committed. Negative when commitments outrun cash --
   * a plain fact, rendered without alarm. No budget is subtracted: a
   * category that is both budgeted and funded by a recurring transaction
   * would otherwise be counted twice.
   */
  safeToSpend: number;
  /**
   * safeToSpend spread across daysRemaining. null only when safeToSpend is
   * negative -- there's no daily allowance to show when you're already short
   * (the UI states the shortfall instead). Zero is a real $0/day.
   */
  perDay: number | null;
  /** Calendar days from today through periodEnd, inclusive. Always >= 1. */
  daysRemaining: number;
  /** Last day of the current calendar month, "YYYY-MM-DD". */
  periodEnd: string;
};

type RawRecurringRow = {
  id: string;
  description: string;
  amount: number;
  next_run_date: string;
  end_date: string | null;
  category: { category_type: string };
};

// "Safe to spend" = asset-account cash, minus the recurring bills still to
// land this month. Deliberately no budget term -- see SafeToSpend.safeToSpend.
//
// cash comes from v_net_worth (SQL-summed); the recurring side is read from
// the base table, not v_upcoming_recurring, because that view drops the
// column that carries Income/Expense direction. A recurring template's
// direction is its category's category_type.
//
// The one subtraction and the commitment sum run in integer cents, never JS
// floats -- amount is exact `numeric` and this figure is shown to the cent
// (same rule TransactionsList's selected-total already follows).
export async function getSafeToSpend(): Promise<DbResult<SafeToSpend>> {
  const supabase = await createClient();

  const today = todayISO();
  const periodEnd = endOfMonthISO(today);
  const daysRemaining = daysBetweenInclusive(today, periodEnd);

  const [assetsRes, recurringRes] = await Promise.all([
    supabase.from("v_net_worth").select("total_assets").maybeSingle(),
    supabase
      .from("recurring_transactions")
      .select(
        "id, description, amount, next_run_date, end_date, category:categories!inner(category_type)",
      )
      .eq("is_active", true)
      .gte("next_run_date", today)
      .lte("next_run_date", periodEnd)
      .order("next_run_date", { ascending: true })
      .returns<RawRecurringRow[]>(),
  ]);

  if (assetsRes.error) {
    return { data: null, error: assetsRes.error.message };
  }
  if (recurringRes.error) {
    return { data: null, error: recurringRes.error.message };
  }

  const commitments: SafeToSpendCommitment[] = recurringRes.data
    // Outflows only. An Income recurring template funds the account, it
    // doesn't draw it down.
    .filter((row) => row.category.category_type === "Expense")
    // Mirror v_upcoming_recurring's own end-date guard: a template that has
    // already ended isn't due again even if next_run_date wasn't advanced.
    .filter((row) => row.end_date === null || row.end_date >= today)
    .map((row) => ({
      recurringId: row.id,
      name: row.description,
      amount: row.amount,
      dueDate: row.next_run_date,
    }));

  const cashCents = Math.round((assetsRes.data?.total_assets ?? 0) * 100);
  const committedCents = commitments.reduce(
    (cents, c) => cents + Math.round(c.amount * 100),
    0,
  );
  const safeCents = cashCents - committedCents;

  return {
    data: {
      cashOnHand: cashCents / 100,
      commitments,
      committed: committedCents / 100,
      safeToSpend: safeCents / 100,
      perDay: safeCents >= 0 ? safeCents / daysRemaining / 100 : null,
      daysRemaining,
      periodEnd,
    },
    error: null,
  };
}

export type DashboardStat = {
  /** The current (this-month, or as-of-now) figure. */
  value: number;
  /**
   * 12 monthly points, oldest first, the last being the current month.
   * Dollars.
   */
  points: number[];
  /** Current month minus the prior month. Dollars, signed. */
  delta: number;
};

export type DashboardStats = {
  netWorth: DashboardStat;
  income: DashboardStat;
  spending: DashboardStat;
};

// First-of-month ISO strings for the last 12 calendar months, oldest first,
// ending with the current month -- the x-axis for every stat-tile sparkline.
// Local calendar months, matching v_monthly_cashflow.month (date_trunc to
// the 1st) and the rest of this file's local-day handling.
function last12MonthStartsISO(): string[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const out: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(y, m - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
  }
  return out;
}

// The three trend tiles under the dashboard hero. Income and spending come
// straight off v_monthly_cashflow. Net worth is back-cast: v_net_worth gives
// today's figure, and every earlier month-end is that figure minus the
// net cashflow that has landed since -- exact here because in this schema
// net worth only moves through transactions (opening balances are fixed,
// investments are carried at cost, transfers net to zero). The one blind
// spot is a soft-deleted account with past activity: v_net_worth counts
// only active accounts while v_monthly_cashflow counts all, which can skew
// the older sparkline points but never today's value.
//
// All arithmetic is in integer cents -- amount is exact `numeric` and these
// figures show to the cent (same rule as getSafeToSpend / TransactionsList).
export async function getDashboardStats(): Promise<DbResult<DashboardStats>> {
  const supabase = await createClient();

  const months = last12MonthStartsISO();

  const [netWorthRes, cashflowRes] = await Promise.all([
    supabase.from("v_net_worth").select("net_worth").maybeSingle(),
    supabase
      .from("v_monthly_cashflow")
      .select("month, income, expenses")
      .gte("month", months[0])
      .order("month", { ascending: true }),
  ]);

  if (netWorthRes.error) {
    return { data: null, error: netWorthRes.error.message };
  }
  if (cashflowRes.error) {
    return { data: null, error: cashflowRes.error.message };
  }

  const byMonth = new Map(cashflowRes.data.map((row) => [row.month, row]));
  const toCents = (n: number | null | undefined) => Math.round((n ?? 0) * 100);

  const incomeCents = months.map((m) => toCents(byMonth.get(m)?.income));
  const expenseCents = months.map((m) => toCents(byMonth.get(m)?.expenses));
  const netCashflowCents = months.map((_, i) => incomeCents[i] - expenseCents[i]);

  const netWorthCents = new Array<number>(12);
  netWorthCents[11] = toCents(netWorthRes.data?.net_worth);
  for (let k = 10; k >= 0; k--) {
    netWorthCents[k] = netWorthCents[k + 1] - netCashflowCents[k + 1];
  }

  const toDollars = (cents: number[]) => cents.map((c) => c / 100);
  const stat = (cents: number[]): DashboardStat => ({
    value: cents[11] / 100,
    points: toDollars(cents),
    delta: (cents[11] - cents[10]) / 100,
  });

  return {
    data: {
      netWorth: stat(netWorthCents),
      income: stat(incomeCents),
      spending: stat(expenseCents),
    },
    error: null,
  };
}

// Ops-only (see DATABASE.md) -- no user-facing screen reads this.
export async function getIntegrityIssues(): Promise<DbResult<IntegrityIssueRow[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase.from("v_integrity_issues").select("*");

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

// Current holdings, not a transaction history -- no date range applies.
export async function getInvestmentHoldings(): Promise<DbResult<InvestmentHoldingRow[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("v_investment_holdings")
    .select("*")
    .order("account_name", { ascending: true })
    .order("ticker", { ascending: true });

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

// Current portfolio snapshot, grouped by account -- no date range applies.
export async function getPortfolioSummary(): Promise<DbResult<PortfolioSummaryRow[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("v_portfolio_summary")
    .select("*")
    .order("account_name", { ascending: true });

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}
