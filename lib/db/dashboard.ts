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
export async function getNetWorth(): Promise<DbResult<NetWorthRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase.from("v_net_worth").select("*").single();

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
export async function getGoalsSummary(): Promise<DbResult<GoalsSummaryRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase.from("v_goals_summary").select("*").single();

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
