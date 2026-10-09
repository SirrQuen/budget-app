import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { addDaysISO, endOfMonthISO, daysBetweenInclusive, monthStartISO } from "@/lib/date";
import type { DashboardRange } from "@/lib/dashboardRange";
import { describeReadError } from "@/lib/db/errors";
import { getSafeToSpendWindowPref, getSafeToSpendCushion, getToday } from "@/lib/db/settings";
import { getBankHolidays } from "@/lib/db/holidays";
import { paydayWindowEnd } from "@/lib/recurringSchedule";
import type { NonBusinessDayRule } from "@/lib/businessDays";
import {
  projectSafeToSpend,
  type OverdueOccurrence,
  type ProjectedObligation,
  type ProjectionSchedule,
  type SafeToSpendProjection,
} from "@/lib/safeToSpendProjection";
import { isSpendableAccountType } from "@/lib/safeToSpend";
import { deriveLoggingStreak, type LoggingStreakSummary } from "@/lib/streak";

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

// ---------------------------------------------------------------------------
// Onboarding stage
//
// A brand-new user walks through distinct stages, and the dashboard renders a
// different screen for each -- a wall of $0 tiles and empty charts reads as
// broken. This is the cheap read that decides which one: two head-count
// queries and the single earliest transaction date.
// ---------------------------------------------------------------------------

export type OnboardingSnapshot = {
  activeAccountCount: number;
  transactionCount: number;
  /** Earliest transaction_date, or null when there are none. */
  firstTransactionDate: string | null;
};

export type DashboardStage =
  | "no-accounts"
  | "no-transactions"
  | "early"
  | "full";

// Below this many days of history, a 90-day trend line is four points of
// noise, not a trend -- the "early" stage suppresses it and says so.
export const EARLY_HISTORY_DAYS = 14;

export async function getDashboardOnboarding(): Promise<DbResult<OnboardingSnapshot>> {
  const supabase = await createClient();

  const [accountsRes, txCountRes, firstTxRes] = await Promise.all([
    supabase
      .from("accounts")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase.from("transactions").select("id", { count: "exact", head: true }),
    supabase
      .from("transactions")
      .select("transaction_date")
      .order("transaction_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (accountsRes.error) {
    return { data: null, error: describeReadError(accountsRes.error, "dashboard") };
  }
  if (txCountRes.error) {
    return { data: null, error: describeReadError(txCountRes.error, "dashboard") };
  }
  if (firstTxRes.error) {
    return { data: null, error: describeReadError(firstTxRes.error, "dashboard") };
  }

  return {
    data: {
      activeAccountCount: accountsRes.count ?? 0,
      transactionCount: txCountRes.count ?? 0,
      firstTransactionDate: firstTxRes.data?.transaction_date ?? null,
    },
    error: null,
  };
}

// Pure -- takes the snapshot and today, returns the stage. Kept separate so
// the page can classify without another round trip and so it's unit-testable.
export function classifyDashboardStage(
  snapshot: OnboardingSnapshot,
  today: string,
): DashboardStage {
  if (snapshot.activeAccountCount === 0) return "no-accounts";
  if (snapshot.transactionCount === 0) return "no-transactions";
  if (
    snapshot.firstTransactionDate &&
    daysBetweenInclusive(snapshot.firstTransactionDate, today) < EARLY_HISTORY_DAYS
  ) {
    return "early";
  }
  return "full";
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
    return { data: null, error: describeReadError(error, "net worth") };
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
    return { data: null, error: describeReadError(error, "cash flow") };
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
    return { data: null, error: describeReadError(error, "cash flow") };
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
    return { data: null, error: describeReadError(error, "spending") };
  }

  return { data, error: null };
}

export type Movement = {
  id: string;
  name: string;
  /** Spend inside the selected range, dollars. */
  current: number;
  /** Spend inside the comparison window (see DashboardRange.prevLabel), dollars. */
  baseline: number;
  /** (current - baseline) / baseline -- signed. 0.34 reads as "up 34%". */
  pctChange: number;
};

export type GroupMovement = Movement & {
  /** Active categories in this group that have a baseline, biggest mover first. */
  categories: Movement[];
};

export type GroupMovementResult = {
  /** Every group with a comparison-window baseline, largest absolute mover first. */
  groups: GroupMovement[];
  /**
   * The one group worth a sentence -- it clears both a percentage and a
   * dollar floor. null is a real answer: a quiet period.
   */
  topMover: GroupMovement | null;
  /** Names the comparison window, e.g. "previous 30 days" -- for the headline copy. */
  prevLabel: string;
};

// A mover must clear both floors: a big percentage on a trivial base
// ($2 -> $3) is noise, and a big dollar swing that's small against the base
// isn't really a move.
const MOVER_MIN_PCT = 0.15;
const MOVER_MIN_DOLLARS = 25;

// Spend per category group inside the selected range, against the same
// group's spend in the comparison window (range.prevFrom..range.prevTo),
// ranked by how far it moved.
//
// category_spend_between() mirrors v_category_spending's Expense side
// (positive amounts, no transfer legs, active categories only) but for
// spans that don't align to month boundaries. Called twice -- selected
// window, then comparison window. Group totals sum their categories in
// integer cents, never JS floats (amount is exact numeric).
//
// Early in a month-to-date range most groups read low; the dollar floor
// and the quiet-period fallback absorb that rather than surfacing a false
// "everything is down".
export async function getGroupMovement(
  range: DashboardRange,
): Promise<DbResult<GroupMovementResult>> {
  const supabase = await createClient();

  const [currentRes, prevRes] = await Promise.all([
    supabase.rpc("category_spend_between", { p_from: range.from, p_to: range.to }),
    supabase.rpc("category_spend_between", { p_from: range.prevFrom, p_to: range.prevTo }),
  ]);

  if (currentRes.error) {
    return { data: null, error: describeReadError(currentRes.error, "spending") };
  }
  if (prevRes.error) {
    return { data: null, error: describeReadError(prevRes.error, "spending") };
  }

  type Acc = { name: string; currentCents: number; prevCents: number };
  type GroupAcc = Acc & { cats: Map<string, Acc> };
  const groups = new Map<string, GroupAcc>();

  const ingest = (
    rows: NonNullable<typeof currentRes.data>,
    bucket: "currentCents" | "prevCents",
  ) => {
    for (const row of rows) {
      if (!row.group_id || !row.category_id) {
        continue;
      }

      let group = groups.get(row.group_id);
      if (!group) {
        group = { name: row.group_name ?? "", currentCents: 0, prevCents: 0, cats: new Map() };
        groups.set(row.group_id, group);
      }

      let cat = group.cats.get(row.category_id);
      if (!cat) {
        cat = { name: row.category_name ?? "", currentCents: 0, prevCents: 0 };
        group.cats.set(row.category_id, cat);
      }

      const cents = Math.round((row.total_spend ?? 0) * 100);
      cat[bucket] += cents;
      group[bucket] += cents;
    }
  };

  ingest(currentRes.data ?? [], "currentCents");
  ingest(prevRes.data ?? [], "prevCents");

  // A movement needs a non-zero baseline; without one there's no percentage
  // to rank by (that's "new spending", a different story).
  const toMovement = (id: string, acc: Acc): Movement | null => {
    const baselineCents = acc.prevCents;
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

  return { data: { groups: groupMovements, topMover, prevLabel: range.prevLabel }, error: null };
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
    return { data: null, error: describeReadError(error, "goals") };
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
    return { data: null, error: describeReadError(error, "goals") };
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
    .order("next_due_date", { ascending: true });

  if (opts.dateFrom) {
    query = query.gte("next_due_date", opts.dateFrom);
  }
  if (opts.dateTo) {
    query = query.lte("next_due_date", opts.dateTo);
  }

  const { data, error } = await query;

  if (error) {
    return { data: null, error: describeReadError(error, "upcoming transactions") };
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

  const today = await getToday();
  const from = addDaysISO(today, -(days - 1));

  const { data, error } = await supabase
    .from("v_daily_cashflow")
    .select("day, income, expenses")
    .gte("day", from)
    .lte("day", today)
    .order("day", { ascending: true });

  if (error) {
    return { data: null, error: describeReadError(error, "cash flow") };
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

// Dates only, no money -- streaks are computed in JS from distinct
// transaction_date values rather than a view, unlike every money figure
// elsewhere in this file. Never stored or incremented: recomputed from
// the transactions table on every read, so there's no counter to drift
// out of sync with reality.
//
// Cached per-request: the dashboard page (Right now mark strip) and
// getReturnSummaryFacts both ask for the streak, and without this that's
// two identical 90-day scans on one dashboard render. The one calculation
// -- deriveLoggingStreak in lib/streak.ts -- feeds both, so they can never
// disagree the way a
// second, separately-maintained implementation could drift.
//
// graceDates is empty until the "nothing to log" / grace-ledger tables
// exist (see lib/streak.ts's module comment on how those are meant to slot
// in later without changing this function's shape); until then every gap
// is just uncovered.
export const getLoggingStreak = cache(async (): Promise<DbResult<LoggingStreakSummary>> => {
  const supabase = await createClient();

  const today = await getToday();

  const { data, error } = await supabase
    .from("transactions")
    .select("transaction_date")
    .gte("transaction_date", addDaysISO(today, -90));

  if (error) {
    return { data: null, error: describeReadError(error, "streak") };
  }

  const summary = deriveLoggingStreak(
    data.map((row) => row.transaction_date),
    [],
    today,
  );

  return { data: summary, error: null };
});

export type SafeToSpendCommitment = ProjectedObligation;

/** The fallback window, when there's no income schedule to project to. */
export type SafeToSpendWindowReason = "next_payday" | "end_of_month" | "next_30_days";

export type SafeToSpendIncome = {
  recurringId: string;
  name: string;
  amount: number;
  /** next_due_date of the soonest upcoming Income schedule -- the anchor. */
  date: string;
  /**
   * date_tolerance_days -- 0 for a fixed-date schedule. The projection
   * counts the paycheck on the LATE edge (anchor + tolerance -- see
   * lib/recurringSchedule.ts's paydayWindowEnd); this display date stays
   * the anchor itself.
   */
  dateToleranceDays: number;
  /**
   * True when amount is a guess (amount_is_variable, unconfirmed) rather
   * than a known figure -- CLAUDE.md "Display": always mark an estimate.
   */
  isEstimate: boolean;
};

export type SafeToSpend = SafeToSpendProjection & {
  /**
   * Window mode only: which window applied. Not always the stored
   * preference -- 'next_payday' falls back to 'end_of_month' with no
   * income schedule, and the UI must say which one actually applied.
   * null in projection mode.
   */
  windowReason: SafeToSpendWindowReason | null;
  /** True when the cushion is the suggestion rather than a stored choice. */
  cushionIsDefault: boolean;
  /**
   * overdueObligations, plus what the breakdown's "did it go out?" line
   * needs. cardPayment is set for a variable card payment still waiting on
   * its amount -- "yes" there means confirming the amount, not posting a
   * guess.
   */
  overdueBills: SafeToSpendOverdueBill[];
  /**
   * The soonest upcoming Income schedule landing in a Checking or Savings
   * account -- a context line beneath the total, outside the breakdown's
   * arithmetic. null when there isn't one, which the UI reads as "show a
   * prompt to add a paycheck."
   */
  nextIncome: SafeToSpendIncome | null;
};

export type SafeToSpendOverdueBill = OverdueOccurrence & {
  cardPayment: { cardName: string; statementDay: number; runDate: string } | null;
};

type UpcomingProjectionRow = {
  recurring_id: string;
  description: string;
  amount: number;
  amount_low: number | null;
  is_estimated_amount: boolean;
  // Null for a transfer template.
  category_type: string | null;
  accountid: string;
  account_type: string;
  to_accountid: string | null;
  // Null for a category schedule; always set for a Transfer.
  to_account_type: string | null;
  // What the destination card owes today; set only for a variable card payment.
  card_balance_owed: number | null;
  next_run_date: string;
  next_due_date: string;
  start_date: string | null;
  end_date: string | null;
  frequency: string;
  interval_count: number;
  business_day_offset: number;
  non_business_day_rule: string;
  date_tolerance_days: number;
  occurrences_remaining: number | null;
  amount_is_variable: boolean;
  next_amount_confirmed_at: string | null;
  statement_day: number | null;
  to_account_name: string | null;
};

type UpcomingIncomeRow = {
  recurring_id: string;
  description: string;
  amount: number;
  next_due_date: string;
  date_tolerance_days: number;
  is_estimated_amount: boolean;
  account_type: string | null;
};

export type IncomeSchedules = {
  /** The soonest Income schedule paying into Checking or Savings. */
  soonest: SafeToSpendIncome | null;
  /**
   * Any active Income schedule exists, whatever account it pays into. With
   * soonest null, this is what separates "no paycheck at all" from "a
   * paycheck safe to spend doesn't track" on the settings page.
   */
  anyIncome: boolean;
};

// One read, both facts. Every Income schedule comes back (a handful of
// rows) rather than only Checking/Savings ones, so the settings page can
// tell the two idle cases apart without a second round trip. account_type
// comes from v_upcoming_recurring's own join to accounts -- an Income
// category schedule's accountid is where the money lands, same as any
// category schedule (see lib/db/recurring.ts's generateDueOccurrences).
export const getIncomeSchedules = cache(async (): Promise<DbResult<IncomeSchedules>> => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("v_upcoming_recurring")
    .select(
      "recurring_id, description, amount, next_due_date, date_tolerance_days, is_estimated_amount, account_type",
    )
    .eq("category_type", "Income")
    .order("next_due_date", { ascending: true })
    .returns<UpcomingIncomeRow[]>();

  if (error) {
    return { data: null, error: describeReadError(error, "dashboard") };
  }

  const row = data.find((r) => r.account_type !== null && isSpendableAccountType(r.account_type));

  return {
    data: {
      soonest: row
        ? {
            recurringId: row.recurring_id,
            name: row.description,
            amount: row.amount,
            date: row.next_due_date,
            dateToleranceDays: row.date_tolerance_days,
            isEstimate: row.is_estimated_amount,
          }
        : null,
      anyIncome: data.length > 0,
    },
    error: null,
  };
});

// Shared by getSafeToSpend (the context line beneath the total) and the
// settings page (to pre-select the fallback window toggle when the stored
// preference is unset -- see lib/safeToSpendWindow.ts). A view over
// getIncomeSchedules(), so the two share one cache()'d query per request.
export const getSoonestIncomeOccurrence = cache(
  async (): Promise<DbResult<SafeToSpendIncome | null>> => {
    const result = await getIncomeSchedules();
    return result.error !== null
      ? { data: null, error: result.error }
      : { data: result.data.soonest, error: null };
  },
);

function toProjectionSchedule(row: UpcomingProjectionRow): ProjectionSchedule | null {
  const kind =
    row.to_accountid !== null
      ? "Transfer"
      : row.category_type === "Income"
        ? "Income"
        : row.category_type === "Expense"
          ? "Expense"
          : null;
  if (kind === null) {
    return null;
  }

  return {
    recurringId: row.recurring_id,
    name: row.description,
    kind,
    accountId: row.accountid,
    fromAccountType: row.account_type,
    toAccountId: row.to_accountid,
    toAccountType: row.to_account_type,
    statementDay: row.statement_day,
    cardPayment:
      row.card_balance_owed !== null
        ? {
            amountConfirmed: row.next_amount_confirmed_at !== null,
            balanceOwed: row.card_balance_owed,
          }
        : null,
    amount: row.amount,
    amountLow: row.amount_low,
    isEstimate: row.is_estimated_amount,
    nextRunDate: row.next_run_date,
    nextDueDate: row.next_due_date,
    anchorDate: row.start_date ?? row.next_run_date,
    frequency: row.frequency,
    intervalCount: row.interval_count,
    businessDayOffset: row.business_day_offset,
    nonBusinessDayRule: row.non_business_day_rule as NonBusinessDayRule,
    dateToleranceDays: row.date_tolerance_days,
    endDate: row.end_date,
    occurrencesRemaining: row.occurrences_remaining,
  };
}

// "Safe to spend" = the lowest the spendable balance gets between today
// and the horizon, minus a cushion, floored at zero. The calculation
// itself -- horizon, which rows count, the date/amount edges, the
// day-by-day walk -- lives in lib/safeToSpendProjection.ts, pure and
// unit tested. This function only gathers its inputs:
//
//   cash       spendable_cash_balance(): active Checking + Savings
//              balances, summed in SQL. Investment, Cash, Credit Card and
//              Loan never contribute.
//   schedules  every row of v_upcoming_recurring, which already applies
//              is_active, the end-date guard and the occurrence_limit
//              guard. The projection steps each one forward past its next
//              occurrence itself.
//   cushion    settings.safe_to_spend_cushion, or the suggestion.
//   holidays   for resolving occurrences after the stored next_due_date.
//   window     the settings fallback (next payday / end of month / 30
//              days), used only when there's no usable income schedule.
//
// No budget term: a category that is both budgeted and funded by a
// recurring transaction would otherwise be counted twice.
export async function getSafeToSpend(): Promise<DbResult<SafeToSpend>> {
  const supabase = await createClient();

  const today = await getToday();

  const [cashRes, recurringRes, incomeRes, cushionRes, holidaysRes, windowPref] = await Promise.all([
    supabase.rpc("spendable_cash_balance"),
    supabase
      .from("v_upcoming_recurring")
      .select(
        "recurring_id, description, amount, amount_low, is_estimated_amount, category_type, accountid, account_type, to_accountid, to_account_type, card_balance_owed, next_run_date, next_due_date, start_date, end_date, frequency, interval_count, business_day_offset, non_business_day_rule, date_tolerance_days, occurrences_remaining, amount_is_variable, next_amount_confirmed_at, statement_day, to_account_name",
      )
      .returns<UpcomingProjectionRow[]>(),
    getSoonestIncomeOccurrence(),
    getSafeToSpendCushion(),
    getBankHolidays(),
    getSafeToSpendWindowPref(),
  ]);

  if (cashRes.error) {
    return { data: null, error: describeReadError(cashRes.error, "dashboard") };
  }
  if (recurringRes.error) {
    return { data: null, error: describeReadError(recurringRes.error, "dashboard") };
  }
  if (incomeRes.error) {
    return { data: null, error: incomeRes.error };
  }
  if (cushionRes.error !== null) {
    return { data: null, error: cushionRes.error };
  }

  // Fallback window -- the same rules as before the projection existed.
  // An unset preference behaves as 'next_payday', which with no income
  // schedule is end of month.
  const effectivePref = windowPref ?? "next_payday";
  let fallbackWindowEnd: string;
  let fallbackReason: SafeToSpendWindowReason;
  if (effectivePref === "next_payday" && incomeRes.data) {
    fallbackWindowEnd = paydayWindowEnd(incomeRes.data.date, incomeRes.data.dateToleranceDays);
    fallbackReason = "next_payday";
  } else if (effectivePref === "next_30_days") {
    fallbackWindowEnd = addDaysISO(today, 30);
    fallbackReason = "next_30_days";
  } else {
    fallbackWindowEnd = endOfMonthISO(today);
    fallbackReason = "end_of_month";
  }
  if (fallbackWindowEnd < today) {
    fallbackWindowEnd = today;
  }

  // Summed in SQL (migration 47): active accounts in the spendable set.
  const projection = projectSafeToSpend({
    today,
    cash: cashRes.data,
    cushion: cushionRes.data.amount,
    schedules: recurringRes.data
      .map(toProjectionSchedule)
      .filter((s): s is ProjectionSchedule => s !== null),
    // A failed holiday read degrades to weekends-only, same as
    // generateDueOccurrences -- not a reason to fail the hero.
    holidays: holidaysRes.data ?? new Set<string>(),
    fallbackWindowEnd,
  });

  const rowsById = new Map(recurringRes.data.map((r) => [r.recurring_id, r]));
  const overdueBills = projection.overdueObligations.map((o): SafeToSpendOverdueBill => {
    const row = rowsById.get(o.recurringId);
    const awaitingCardAmount =
      row !== undefined &&
      row.to_accountid !== null &&
      row.amount_is_variable &&
      row.next_amount_confirmed_at === null &&
      row.statement_day !== null;
    return {
      ...o,
      cardPayment: awaitingCardAmount
        ? {
            cardName: row.to_account_name ?? "the card",
            statementDay: row.statement_day!,
            runDate: row.next_run_date,
          }
        : null,
    };
  });

  return {
    data: {
      ...projection,
      overdueBills,
      windowReason: projection.mode === "window" ? fallbackReason : null,
      cushionIsDefault: cushionRes.data.isDefault,
      nextIncome: incomeRes.data,
    },
    error: null,
  };
}

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

// First-of-month ISO strings for the last 12 calendar months, oldest first,
// ending with the current month -- the x-axis for every stat-tile sparkline.
// The user's calendar months, matching v_monthly_cashflow.month (date_trunc
// to the 1st).
function last12MonthStartsISO(today: string): string[] {
  const [y, mm] = monthStartISO(today).split("-").map(Number);
  const m = mm - 1;
  const out: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(y, m - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
  }
  return out;
}

// The net-worth tile in the dashboard's "Right now" region -- an as-of-now
// figure, a month-over-month delta, and a 12-month sparkline. It stays
// monthly and unfiltered: net worth is point-in-time, so a historical
// date range has nothing to say about it.
//
// Net worth is back-cast: v_net_worth gives today's figure, and every
// earlier month-end is that figure minus the net cashflow that has landed
// since -- exact here because in this schema net worth only moves through
// transactions (opening balances are fixed, investments are carried at
// cost, transfers net to zero). The one blind spot is a soft-deleted
// account with past activity: v_net_worth counts only active accounts
// while v_monthly_cashflow counts all, which can skew the older sparkline
// points but never today's value.
//
// All arithmetic is in integer cents -- amount is exact `numeric` and these
// figures show to the cent (same rule as getSafeToSpend / TransactionsList).
export async function getNetWorthStat(): Promise<DbResult<DashboardStat>> {
  const supabase = await createClient();

  const months = last12MonthStartsISO(await getToday());

  const [netWorthRes, cashflowRes] = await Promise.all([
    supabase.from("v_net_worth").select("net_worth").maybeSingle(),
    supabase
      .from("v_monthly_cashflow")
      .select("month, income, expenses")
      .gte("month", months[0])
      .order("month", { ascending: true }),
  ]);

  if (netWorthRes.error) {
    return { data: null, error: describeReadError(netWorthRes.error, "net worth") };
  }
  if (cashflowRes.error) {
    return { data: null, error: describeReadError(cashflowRes.error, "net worth") };
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

  return {
    data: {
      value: netWorthCents[11] / 100,
      points: netWorthCents.map((c) => c / 100),
      delta: (netWorthCents[11] - netWorthCents[10]) / 100,
    },
    error: null,
  };
}

// The Income and Spending tiles in the dashboard's "Over time" region --
// each a range total, a delta against the comparison window, and a
// sparkline bucketed to the range's granularity (~daily to a month,
// weekly to six, monthly beyond).
//
// One read off v_daily_cashflow spanning prevFrom..to; every figure is
// summed off that daily grid in integer cents (amount is exact `numeric`;
// same rule as getNetWorthStat / getSafeToSpend). v_daily_cashflow only
// has rows for days with activity, so a missing day is a real zero.
export async function getRangeCashflowStats(
  range: DashboardRange,
): Promise<DbResult<RangeCashflowStats>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("v_daily_cashflow")
    .select("day, income, expenses")
    .gte("day", range.prevFrom)
    .lte("day", range.to)
    .order("day", { ascending: true });

  if (error) {
    return { data: null, error: describeReadError(error, "cash flow") };
  }

  const toCents = (n: number | null | undefined) => Math.round((n ?? 0) * 100);
  const byDay = new Map(
    data.filter((r): r is typeof r & { day: string } => r.day !== null).map((r) => [r.day, r]),
  );

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

  const stat = (key: "income" | "expenses"): DashboardStat => {
    const valueCents = sumSpan(range.from, range.to, key);
    const prevCents = sumSpan(range.prevFrom, range.prevTo, key);
    const points = bucketStarts.map((start, i) => {
      const end =
        i + 1 < bucketStarts.length ? addDaysISO(bucketStarts[i + 1], -1) : range.to;
      return sumSpan(start, end, key) / 100;
    });
    return { value: valueCents / 100, points, delta: (valueCents - prevCents) / 100 };
  };

  return { data: { income: stat("income"), spending: stat("expenses") }, error: null };
}

// Ops-only (see DATABASE.md) -- no user-facing screen reads this.
export async function getIntegrityIssues(): Promise<DbResult<IntegrityIssueRow[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase.from("v_integrity_issues").select("*");

  if (error) {
    return { data: null, error: describeReadError(error, "data") };
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
    return { data: null, error: describeReadError(error, "investments") };
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
    return { data: null, error: describeReadError(error, "investments") };
  }

  return { data, error: null };
}
