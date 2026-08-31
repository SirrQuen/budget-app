import { recordLogin } from "@/lib/db/profile";
import {
  getSafeToSpend,
  getNetWorthStat,
  getLoggingStreak,
  getRangeCashflowStats,
  getCashflowChart,
  getGroupMovement,
  getGoalProgress,
  getUpcomingRecurring,
} from "@/lib/db/dashboard";
import { getBudgetProgress } from "@/lib/db/budgets";
import { getReturnSummaryFacts } from "@/lib/actions/activity";
import { todayISO } from "@/lib/date";
import { resolveDashboardRange } from "@/lib/dashboardRange";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import { ReturnSummaryStrip } from "@/components/ui/ReturnSummaryStrip";
import { SafeToSpendHero } from "./SafeToSpendHero";
import { ScopedRegion } from "./ScopedRegion";
import { CashflowChart } from "./CashflowChart";
import { GroupMovementChart } from "./GroupMovementChart";
import { BudgetMeters } from "./BudgetMeters";
import { GoalMeters } from "./GoalMeters";
import { UpcomingList } from "./UpcomingList";

// Auth is already enforced by app/(app)/layout.tsx's requireUser() before
// this page renders.
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const params = await searchParams;
  const range = resolveDashboardRange(params);
  const currentMonth = `${todayISO().slice(0, 7)}-01`;

  // Cache hit -- app/(app)/layout.tsx already ran recordLogin() this
  // request, so this is free and gives us the pre-bump lastlogin. null on a
  // first-ever login. getReturnSummaryFacts self-gates on how long ago that
  // was, so an empty list here means "too recent, or nothing changed".
  const greetingResult = await recordLogin();
  const previousLoginAt = greetingResult.data?.previousLoginAt ?? null;

  const [
    safeToSpendResult,
    netWorthResult,
    streakResult,
    budgetResult,
    goalResult,
    recurringResult,
    returnFacts,
    rangeStatsResult,
    cashflowResult,
    movementResult,
  ] = await Promise.all([
    getSafeToSpend(),
    getNetWorthStat(),
    getLoggingStreak(),
    getBudgetProgress({ budget_month: currentMonth }),
    getGoalProgress(),
    getUpcomingRecurring(),
    previousLoginAt
      ? getReturnSummaryFacts(previousLoginAt)
      : Promise.resolve<string[]>([]),
    getRangeCashflowStats(range),
    getCashflowChart(),
    getGroupMovement(range),
  ]);

  const firstName = greetingResult.data?.firstName;
  const namePart = firstName ? `, ${firstName}` : "";
  const description = greetingResult.data?.isFirstLogin
    ? `Welcome to EverNest${namePart}.`
    : `Welcome back${namePart}.`;

  const netWorth = netWorthResult.data;
  const streak = streakResult.data;
  const rangeStats = rangeStatsResult.data;

  // Nothing to plot until there's at least one day of activity in the window.
  const cashflow = cashflowResult.data?.some((p) => p.income > 0 || p.expenses > 0)
    ? cashflowResult.data
    : null;
  // No baseline anywhere means no story to tell -- skip the section entirely.
  const movement =
    movementResult.data && movementResult.data.groups.length > 0 ? movementResult.data : null;

  // v_budget_vs_actual is ordered status_rank desc (problems first); a
  // budget_id of null is a spent-but-unbudgeted category, not a budget.
  const topBudgets =
    budgetResult.data?.filter((b) => b.budget_id !== null).slice(0, 3) ?? [];
  const activeGoals = goalResult.data?.filter((g) => g.status === "Active").slice(0, 3) ?? [];
  const upcoming = recurringResult.data?.slice(0, 5) ?? [];
  const hasPanels = topBudgets.length > 0 || activeGoals.length > 0 || upcoming.length > 0;

  return (
    <div className="flex flex-col gap-10">
      {/* ── Right now: as-of-today and forward-looking; not scoped by the filter ── */}
      <section className="flex flex-col gap-6" aria-labelledby="dash-right-now">
        <PageHeader title="Dashboard" description={description} />
        <h2 id="dash-right-now" className="text-sm font-medium text-ink-secondary">
          Right now
        </h2>

        {previousLoginAt && returnFacts.length > 0 ? (
          <ReturnSummaryStrip since={previousLoginAt} facts={returnFacts} />
        ) : null}
        {safeToSpendResult.data ? <SafeToSpendHero data={safeToSpendResult.data} /> : null}

        {(netWorth || streak) ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {netWorth ? (
              <StatTile
                id="dashboard-net-worth"
                label="Net worth"
                value={netWorth.value}
                format="currency"
                delta={{
                  value: netWorth.delta,
                  periodLabel: "last month",
                  format: "currency",
                  goodWhen: "up",
                }}
                trend={netWorth.points}
              />
            ) : null}
            {streak ? (
              <StatTile
                id="dashboard-streak"
                label="Logging streak"
                value={streak.current}
                format="number"
                footnote={`Best: ${streak.best} day${streak.best === 1 ? "" : "s"}`}
              />
            ) : null}
          </div>
        ) : null}

        {hasPanels ? (
          <div className="flex flex-col gap-4 lg:flex-row">
            {topBudgets.length > 0 ? (
              <div className="min-w-0 lg:flex-1 lg:basis-0">
                <BudgetMeters budgets={topBudgets} />
              </div>
            ) : null}
            {activeGoals.length > 0 ? (
              <div className="min-w-0 lg:flex-1 lg:basis-0">
                <GoalMeters goals={activeGoals} />
              </div>
            ) : null}
            {upcoming.length > 0 ? (
              <div className="min-w-0 lg:flex-1 lg:basis-0">
                <UpcomingList items={upcoming} />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* ── Over time: everything the date-range filter scopes ── */}
      <ScopedRegion range={range}>
        {rangeStats ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              id="dashboard-income"
              label="Income"
              value={rangeStats.income.value}
              format="currency"
              delta={{
                value: rangeStats.income.delta,
                periodLabel: range.prevLabel,
                format: "currency",
                goodWhen: "up",
              }}
              trend={rangeStats.income.points}
            />
            <StatTile
              id="dashboard-spending"
              label="Spending"
              value={rangeStats.spending.value}
              format="currency"
              delta={{
                value: rangeStats.spending.delta,
                periodLabel: range.prevLabel,
                format: "currency",
                goodWhen: "down",
              }}
              trend={rangeStats.spending.points}
            />
          </div>
        ) : null}

        {cashflow ? (
          <CashflowChart points={cashflow} shadeFrom={range.from} shadeTo={range.to} />
        ) : null}
        {movement ? <GroupMovementChart data={movement} /> : null}
      </ScopedRegion>
    </div>
  );
}
