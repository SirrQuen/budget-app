import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

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

// Dates only, no money -- streaks are computed in JS from distinct
// transaction_date values rather than a view, unlike every money figure
// elsewhere in this file.
export async function getLoggingStreak(): Promise<DbResult<LoggingStreak>> {
  const supabase = await createClient();

  const today = new Date();
  const since = new Date(today);
  since.setDate(since.getDate() - 90);

  const { data, error } = await supabase
    .from("transactions")
    .select("transaction_date")
    .gte("transaction_date", localISODate(since))
    .order("transaction_date", { ascending: true });

  if (error) {
    return { data: null, error: error.message };
  }

  const dates = [...new Set(data.map((row) => row.transaction_date))].sort();

  let best = 0;
  let run = 0;
  for (let i = 0; i < dates.length; i++) {
    run = i > 0 && isNextCalendarDay(dates[i - 1], dates[i]) ? run + 1 : 1;
    best = Math.max(best, run);
  }

  const todayISO = localISODate(today);
  const yesterdayISO = localISODate(new Date(today.getTime() - 86_400_000));
  const last = dates[dates.length - 1];

  let current = 0;
  if (last === todayISO || last === yesterdayISO) {
    current = 1;
    for (let i = dates.length - 1; i > 0; i--) {
      if (isNextCalendarDay(dates[i - 1], dates[i])) {
        current += 1;
      } else {
        break;
      }
    }
  }

  return { data: { current, best, loggedToday: last === todayISO }, error: null };
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
