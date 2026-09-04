import { recordLogin } from "@/lib/db/profile";
import {
  getDashboardOnboarding,
  classifyDashboardStage,
  getSafeToSpend,
  getNetWorth,
  getNetWorthStat,
  getLoggingStreak,
  getRangeCashflowStats,
  getCashflowChart,
  getGroupMovement,
  getGoalProgress,
  getUpcomingRecurring,
} from "@/lib/db/dashboard";
import { getBudgetProgress } from "@/lib/db/budgets";
import { listAccountBalances } from "@/lib/db/accounts";
import { generateDueOccurrences } from "@/lib/db/recurring";
import { getReturnSummaryFacts } from "@/lib/actions/activity";
import { todayISO } from "@/lib/date";
import { resolveDashboardRange } from "@/lib/dashboardRange";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import { ReturnSummaryStrip } from "@/components/ui/ReturnSummaryStrip";
import { GeneratedOccurrencesBanner } from "./GeneratedOccurrencesBanner";
import { SafeToSpendHero } from "./SafeToSpendHero";
import { ScopedRegion } from "./ScopedRegion";
import { CashflowChart } from "./CashflowChart";
import { GroupMovementChart } from "./GroupMovementChart";
import { BudgetMeters } from "./BudgetMeters";
import { GoalMeters } from "./GoalMeters";
import { UpcomingList } from "./UpcomingList";
import { SectionError } from "./SectionError";
import { NoAccountsView, NoTransactionsView } from "./DashboardOnboarding";

// Auth is already enforced by app/(app)/layout.tsx's requireUser() before
// this page renders.
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const params = await searchParams;
  const range = resolveDashboardRange(params);
  const today = todayISO();
  const currentMonth = `${today.slice(0, 7)}-01`;

  // recordLogin() is a two-round-trip read-then-write (see lib/db/profile.ts),
  // and app/(app)/layout.tsx fires it too -- it's cache()d, so asking again
  // here is free. The point is not to *await* it ahead of the main batch:
  // only the return-summary strip needs its result, so that single read is
  // chained off it while everything else starts immediately.
  const greetingPromise = recordLogin();
  const returnFactsPromise = greetingPromise.then((r) => {
    const prev = r.data?.previousLoginAt ?? null;
    return prev ? getReturnSummaryFacts(prev) : ([] as string[]);
  });

  // Lazy catch-up (see CLAUDE.md "Recurring transactions") -- must finish
  // before anything below reads a balance, a budget, cashflow, or the
  // upcoming list, every one of which this can change by inserting
  // transactions and advancing next_run_date. Unrelated to the greeting/
  // return-facts chain above, so it's still in flight concurrently with
  // that request; only the batch below has to wait for it.
  const generatedResult = await generateDueOccurrences();
  const generatedOccurrences = generatedResult.data ?? [];

  // One batch, all in flight together. A brand-new user (stages 1-2) fetches
  // a few results it won't render -- all cheap and empty -- which is the price
  // of not adding a waterfall for the common full-dashboard case.
  const [
    greetingResult,
    onboardingResult,
    safeToSpendResult,
    netWorthStatResult,
    streakResult,
    budgetResult,
    goalResult,
    recurringResult,
    returnFacts,
    rangeStatsResult,
    cashflowResult,
    movementResult,
    balancesResult,
    netWorthResult,
  ] = await Promise.all([
    greetingPromise,
    getDashboardOnboarding(),
    getSafeToSpend(),
    getNetWorthStat(),
    getLoggingStreak(),
    getBudgetProgress({ budget_month: currentMonth }),
    getGoalProgress(),
    getUpcomingRecurring(),
    returnFactsPromise,
    getRangeCashflowStats(range),
    getCashflowChart(),
    getGroupMovement(range),
    listAccountBalances({ is_active: true }),
    getNetWorth(),
  ]);

  const firstName = greetingResult.data?.firstName;
  const isFirstLogin = greetingResult.data?.isFirstLogin ?? false;
  const previousLoginAt = greetingResult.data?.previousLoginAt ?? null;

  // If the snapshot itself failed we can't tell which stage the user is in --
  // fall through to the full dashboard, where the per-section error handling
  // surfaces whatever's actually broken. A wrong welcome screen would be worse.
  const stage = onboardingResult.data
    ? classifyDashboardStage(onboardingResult.data, today)
    : "full";

  if (stage === "no-accounts") {
    return <NoAccountsView firstName={firstName} />;
  }

  if (stage === "no-transactions") {
    return (
      <NoTransactionsView
        firstName={firstName}
        isFirstLogin={isFirstLogin}
        accounts={balancesResult.data ?? []}
        accountsError={balancesResult.error}
        netWorth={netWorthResult.data?.net_worth ?? null}
      />
    );
  }

  // stage is "early" or "full". Real numbers either way; the 90-day trend
  // charts only make sense once there's a fortnight of history behind them.
  const showTrend = stage === "full";
  const namePart = firstName ? `, ${firstName}` : "";
  const description = isFirstLogin
    ? `Welcome to EverNest${namePart}.`
    : `Welcome back${namePart}.`;

  const streak =
    streakResult.data && (streakResult.data.current > 0 || streakResult.data.best > 0)
      ? streakResult.data
      : null;
  const rangeStats = rangeStatsResult.data;

  // Nothing to plot until there's at least one day of activity in the window.
  const cashflow = cashflowResult.data?.some((p) => p.income > 0 || p.expenses > 0)
    ? cashflowResult.data
    : null;
  const movement =
    movementResult.data && movementResult.data.groups.length > 0
      ? movementResult.data
      : null;

  // v_budget_vs_actual is ordered status_rank desc (problems first); a
  // budget_id of null is a spent-but-unbudgeted category, not a budget.
  const topBudgets =
    budgetResult.data?.filter((b) => b.budget_id !== null).slice(0, 3) ?? [];
  const activeGoals =
    goalResult.data?.filter((g) => g.status === "Active").slice(0, 3) ?? [];
  const upcoming = recurringResult.data?.slice(0, 5) ?? [];

  const showTiles =
    netWorthStatResult.error != null ||
    netWorthStatResult.data != null ||
    streakResult.error != null ||
    streak != null;
  const showPanels =
    budgetResult.error != null ||
    topBudgets.length > 0 ||
    goalResult.error != null ||
    activeGoals.length > 0 ||
    recurringResult.error != null ||
    upcoming.length > 0;

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

        {generatedOccurrences.length > 0 ? (
          <GeneratedOccurrencesBanner
            descriptions={generatedOccurrences.map((t) => t.description)}
          />
        ) : null}

        {safeToSpendResult.error ? (
          <SectionError label="Safe to spend" />
        ) : safeToSpendResult.data ? (
          <SafeToSpendHero data={safeToSpendResult.data} />
        ) : null}

        {showTiles ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {netWorthStatResult.error ? (
              <SectionError label="Net worth" />
            ) : netWorthStatResult.data ? (
              <StatTile
                id="dashboard-net-worth"
                label="Net worth"
                value={netWorthStatResult.data.value}
                format="currency"
                delta={{
                  value: netWorthStatResult.data.delta,
                  periodLabel: "last month",
                  format: "currency",
                  goodWhen: "up",
                }}
                trend={netWorthStatResult.data.points}
              />
            ) : null}
            {streakResult.error ? (
              <SectionError label="Logging streak" />
            ) : streak ? (
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

        {showPanels ? (
          <div className="flex flex-col gap-4 lg:flex-row">
            {budgetResult.error ? (
              <div className="min-w-0 lg:flex-1 lg:basis-0">
                <SectionError label="Budgets" />
              </div>
            ) : topBudgets.length > 0 ? (
              <div className="min-w-0 lg:flex-1 lg:basis-0">
                <BudgetMeters budgets={topBudgets} />
              </div>
            ) : null}
            {goalResult.error ? (
              <div className="min-w-0 lg:flex-1 lg:basis-0">
                <SectionError label="Goals" />
              </div>
            ) : activeGoals.length > 0 ? (
              <div className="min-w-0 lg:flex-1 lg:basis-0">
                <GoalMeters goals={activeGoals} />
              </div>
            ) : null}
            {recurringResult.error ? (
              <div className="min-w-0 lg:flex-1 lg:basis-0">
                <SectionError label="Upcoming" />
              </div>
            ) : upcoming.length > 0 ? (
              <div className="min-w-0 lg:flex-1 lg:basis-0">
                <UpcomingList items={upcoming} />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* ── Over time: everything the date-range filter scopes ── */}
      <ScopedRegion range={range}>
        {rangeStatsResult.error ? (
          <SectionError label="Income and spending" />
        ) : rangeStats ? (
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

        {/* The 90-day trend charts render at "full". At "early" they'd be four
            points of noise, so a plain line stands in for them -- but a real
            load failure always surfaces in place, even early, never hidden
            behind that note. */}
        {cashflowResult.error ? (
          <SectionError label="Cash flow" />
        ) : showTrend && cashflow ? (
          <CashflowChart points={cashflow} shadeFrom={range.from} shadeTo={range.to} />
        ) : null}

        {movementResult.error ? (
          <SectionError label="Category movement" />
        ) : showTrend && movement ? (
          <GroupMovementChart data={movement} />
        ) : null}

        {!showTrend && !cashflowResult.error && !movementResult.error ? (
          <p className="rounded-2xl border border-hairline bg-surface px-4 py-3 text-sm text-ink-secondary">
            Your cash-flow trend and category movement need a couple of weeks of history. Keep
            logging and they show up here.
          </p>
        ) : null}
      </ScopedRegion>
    </div>
  );
}
