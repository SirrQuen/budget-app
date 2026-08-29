import { recordLogin } from "@/lib/db/profile";
import {
  getSafeToSpend,
  getDashboardStats,
  getLoggingStreak,
  getCashflowChart,
  getGroupMovement,
  getGoalProgress,
  getUpcomingRecurring,
} from "@/lib/db/dashboard";
import { getBudgetProgress } from "@/lib/db/budgets";
import { getReturnSummaryFacts } from "@/lib/actions/activity";
import { todayISO } from "@/lib/date";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import { ReturnSummaryStrip } from "@/components/ui/ReturnSummaryStrip";
import { SafeToSpendHero } from "./SafeToSpendHero";
import { CashflowChart } from "./CashflowChart";
import { GroupMovementChart } from "./GroupMovementChart";
import { BudgetMeters } from "./BudgetMeters";
import { GoalMeters } from "./GoalMeters";
import { UpcomingList } from "./UpcomingList";

// Auth is already enforced by app/(app)/layout.tsx's requireUser() before
// this page renders.
export default async function DashboardPage() {
  const currentMonth = `${todayISO().slice(0, 7)}-01`;

  // Cache hit -- app/(app)/layout.tsx already ran recordLogin() this
  // request, so this is free and gives us the pre-bump lastlogin. null on a
  // first-ever login. getReturnSummaryFacts self-gates on how long ago that
  // was, so an empty list here means "too recent, or nothing changed".
  const greetingResult = await recordLogin();
  const previousLoginAt = greetingResult.data?.previousLoginAt ?? null;

  const [
    safeToSpendResult,
    statsResult,
    streakResult,
    cashflowResult,
    movementResult,
    budgetResult,
    goalResult,
    recurringResult,
    returnFacts,
  ] = await Promise.all([
    getSafeToSpend(),
    getDashboardStats(),
    getLoggingStreak(),
    getCashflowChart(),
    getGroupMovement(),
    getBudgetProgress({ budget_month: currentMonth }),
    getGoalProgress(),
    getUpcomingRecurring(),
    previousLoginAt
      ? getReturnSummaryFacts(previousLoginAt)
      : Promise.resolve<string[]>([]),
  ]);

  const firstName = greetingResult.data?.firstName;
  const namePart = firstName ? `, ${firstName}` : "";
  const description = greetingResult.data?.isFirstLogin
    ? `Welcome to EverNest${namePart}.`
    : `Welcome back${namePart}.`;

  const stats = statsResult.data;
  const streak = streakResult.data;
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
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description={description} />
      {previousLoginAt && returnFacts.length > 0 ? (
        <ReturnSummaryStrip since={previousLoginAt} facts={returnFacts} />
      ) : null}
      {safeToSpendResult.data ? <SafeToSpendHero data={safeToSpendResult.data} /> : null}

      {stats ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            id="dashboard-net-worth"
            label="Net worth"
            value={stats.netWorth.value}
            format="currency"
            delta={{
              value: stats.netWorth.delta,
              periodLabel: "last month",
              format: "currency",
              goodWhen: "up",
            }}
            trend={stats.netWorth.points}
          />
          <StatTile
            id="dashboard-income"
            label="Income this month"
            value={stats.income.value}
            format="currency"
            delta={{
              value: stats.income.delta,
              periodLabel: "last month",
              format: "currency",
              goodWhen: "up",
            }}
            trend={stats.income.points}
          />
          <StatTile
            id="dashboard-spending"
            label="Spending this month"
            value={stats.spending.value}
            format="currency"
            delta={{
              value: stats.spending.delta,
              periodLabel: "last month",
              format: "currency",
              goodWhen: "down",
            }}
            trend={stats.spending.points}
          />
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

      {cashflow ? <CashflowChart points={cashflow} /> : null}
      {movement ? <GroupMovementChart data={movement} /> : null}

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
    </div>
  );
}
