import { recordLogin } from "@/lib/db/profile";
import { isFirstSession } from "@/lib/auth/firstSession";
import { welcomeMessage } from "@/lib/displayName";
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
import { isAwaitingStatementAmount, isAwaitingIncomeConfirmation } from "@/lib/recurringSchedule";
import { resolveDashboardRange } from "@/lib/dashboardRange";
import { getTimeZone, getToday } from "@/lib/db/settings";
import { sinceLabel } from "@/lib/sinceLabel";
import { monthStartISO } from "@/lib/date";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import { ReturnSummaryStrip } from "@/components/ui/ReturnSummaryStrip";
import { LoggingStreakStrip } from "@/components/ui/LoggingStreakStrip";
import { GeneratedOccurrencesBanner } from "./GeneratedOccurrencesBanner";
import { VariableAmountPrompt } from "./VariableAmountPrompt";
import { IncomeConfirmPrompt } from "./IncomeConfirmPrompt";
import { SafeToSpendHero } from "./SafeToSpendHero";
import { ScopedRegion } from "./ScopedRegion";
import { CashflowChart } from "./CashflowChart";
import { GroupMovementChart } from "./GroupMovementChart";
import { BudgetMeters } from "./BudgetMeters";
import { GoalMeters } from "./GoalMeters";
import { UpcomingList, type UpcomingScheduleMeta } from "./UpcomingList";
import { buildUpcomingOccurrences } from "@/lib/upcomingOccurrences";
import { SectionError } from "./SectionError";
import { LoadError } from "@/components/ui/LoadError";
import { NoAccountsView, NoTransactionsView } from "./DashboardOnboarding";
import { DayNightMark } from "@/components/DayNightMark";

// Auth is already enforced by app/(app)/layout.tsx's requireUser() before
// this page renders.
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const params = await searchParams;
  const [today, timeZone] = await Promise.all([getToday(), getTimeZone()]);
  const range = resolveDashboardRange(params, today);
  const currentMonth = monthStartISO(today);

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
    firstSession,
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
    // Decided when the session started -- see lib/auth/firstSession.ts.
    isFirstSession(),
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

  // A failed profile read just means no name -- "Welcome back" alone.
  const welcome = welcomeMessage(greetingResult.data ?? {}, firstSession);
  const previousLoginAt = greetingResult.data?.previousLoginAt ?? null;

  // If the snapshot itself failed we can't tell which stage the user is in --
  // fall through to the full dashboard, where the per-section error handling
  // surfaces whatever's actually broken. A wrong welcome screen would be worse.
  const stage = onboardingResult.data
    ? classifyDashboardStage(onboardingResult.data, today)
    : "full";

  if (stage === "no-accounts") {
    return <NoAccountsView welcome={welcome} />;
  }

  if (stage === "no-transactions") {
    return (
      <NoTransactionsView
        welcome={welcome}
        accounts={balancesResult.data ?? []}
        accountsError={balancesResult.error}
        netWorth={netWorthResult.data?.net_worth ?? null}
      />
    );
  }

  // stage is "early" or "full". Real numbers either way; the 90-day trend
  // charts only make sense once there's a fortnight of history behind them.
  const showTrend = stage === "full";

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
  // Built from the projection, not from v_upcoming_recurring's one-row-per-
  // schedule: the list sits beside the safe-to-spend figure and has to
  // show exactly what that figure counted. The view only supplies each
  // schedule's icon and its Confirm target.
  const upcoming = safeToSpendResult.data ? buildUpcomingOccurrences(safeToSpendResult.data, today) : null;
  const upcomingSchedules: Record<string, UpcomingScheduleMeta> = Object.fromEntries(
    (recurringResult.data ?? []).map((r) => [
      r.recurring_id ?? "",
      {
        categoryIcon: r.category_icon,
        isTransfer: r.to_accountid !== null,
        confirm:
          r.next_due_date == null
            ? null
            : r.to_accountid === null && r.requires_confirmation
              ? {
                  kind: "income" as const,
                  dueDate: r.next_due_date,
                  target: {
                    id: r.recurring_id ?? "",
                    name: r.description ?? "",
                    estimatedAmount: r.amount ?? 0,
                    isEstimate: r.is_estimated_amount ?? false,
                    dueDate: r.next_due_date,
                  },
                }
              : r.to_accountid !== null && r.is_estimated_amount
                ? {
                    kind: "card" as const,
                    dueDate: r.next_due_date,
                    target: {
                      id: r.recurring_id ?? "",
                      cardName: r.to_account_name ?? "the card",
                      estimatedAmount: r.amount ?? 0,
                      statementDay: r.statement_day ?? 1,
                      dueDate: r.next_run_date ?? "",
                    },
                  }
                : null,
      },
    ]),
  );

  // The nudge to confirm a card's statement amount runs from the statement
  // date through the due date (see CLAUDE.md "Prompt timing") -- scanned
  // over the FULL upcoming list, not just the 5-item slice above, so a
  // variable schedule further out still gets its prompt.
  const variableAmountPrompts = (recurringResult.data ?? [])
    .filter(
      (r) =>
        r.amount_is_variable === true &&
        r.next_amount_confirmed_at === null &&
        r.statement_day != null &&
        r.next_run_date != null &&
        isAwaitingStatementAmount(today, r.next_run_date, r.statement_day),
    )
    .map((r) => ({
      id: r.recurring_id ?? "",
      cardName: r.to_account_name ?? "the card",
      estimatedAmount: r.amount ?? 0,
      statementDay: r.statement_day!,
      dueDate: r.next_run_date!,
    }));

  // Every Income schedule requires confirmation (CLAUDE.md "Auto-create
  // outflows. Confirm inflows.") -- the prompt opens EARLY, at
  // next_due_date - date_tolerance_days, never the other way round (see
  // lib/recurringSchedule.ts's incomeConfirmationOpensAt/paydayWindowEnd),
  // and stays open indefinitely once due, unlike the card prompt above,
  // since nothing ever auto-posts it closed.
  const incomeConfirmPrompts = (recurringResult.data ?? [])
    .filter(
      (r) =>
        r.to_accountid === null &&
        r.requires_confirmation === true &&
        r.next_due_date != null &&
        isAwaitingIncomeConfirmation(today, r.next_due_date, r.date_tolerance_days ?? 0),
    )
    .map((r) => ({
      id: r.recurring_id ?? "",
      name: r.description ?? "",
      estimatedAmount: r.amount ?? 0,
      isEstimate: r.is_estimated_amount ?? false,
      dueDate: r.next_due_date!,
    }));

  // Every section that renders a SectionError on failure, by its label.
  const failedSections = (
    [
      ["Logging streak", streakResult.error],
      ["Safe to spend", safeToSpendResult.error],
      ["Net worth", netWorthStatResult.error],
      ["Budgets", budgetResult.error],
      ["Goals", goalResult.error],
      ["Upcoming", recurringResult.error],
      ["Income and spending", rangeStatsResult.error],
      ["Cash flow", cashflowResult.error],
      ["Category movement", movementResult.error],
    ] as const
  )
    .filter(([, error]) => error != null)
    .map(([label]) => label);

  // One failure: that section says so in place, with its own retry -- the
  // rest of the page works, so don't send the user through a reload. Two or
  // more almost always share a cause, so one page-level notice with one
  // retry replaces them; the failed slots render nothing.
  //
  // Logged by section either way. lib/db already logs each underlying error,
  // but under coarse resource tags ("dashboard", "cash flow") shared across
  // sections -- this line is what shows a single broken query hiding inside
  // a general outage.
  const pageLevelError = failedSections.length >= 2;
  if (failedSections.length > 0) {
    console.error(
      `[dashboard] ${failedSections.length} section(s) failed to load: ${failedSections.join(", ")}`,
    );
  }
  const sectionError = (label: (typeof failedSections)[number]) =>
    pageLevelError ? null : <SectionError label={label} />;
  const showsError = (error: string | null) => error != null && !pageLevelError;

  const showTiles = showsError(netWorthStatResult.error) || netWorthStatResult.data != null;
  const showMeters =
    showsError(budgetResult.error) ||
    topBudgets.length > 0 ||
    showsError(goalResult.error) ||
    activeGoals.length > 0;
  const showPanels =
    showMeters ||
    showsError(recurringResult.error) ||
    (upcoming !== null && upcoming.items.length > 0);

  return (
    <div className="flex flex-col gap-10">
      {/* ── Right now: as-of-today and forward-looking; not scoped by the filter ── */}
      <section className="flex flex-col gap-6" aria-labelledby="dash-right-now">
        <PageHeader title="Dashboard" description={welcome} />
        {pageLevelError ? <LoadError message="We couldn’t load parts of your dashboard." /> : null}
        {/* The mark is ambient -- day/night for "right now" -- and kept out
            of the hero's row so nothing competes with that figure. */}
        <div className="flex items-center justify-between gap-4">
          <h2 id="dash-right-now" className="text-sm font-medium text-ink-secondary">
            Right now
          </h2>
          <DayNightMark size={56} />
        </div>

        {streakResult.error ? (
          sectionError("Logging streak")
        ) : streakResult.data ? (
          <LoggingStreakStrip
            current={streakResult.data.current}
            longest={streakResult.data.longest}
            segments={streakResult.data.segments}
          />
        ) : null}

        {previousLoginAt && returnFacts.length > 0 ? (
          <ReturnSummaryStrip since={sinceLabel(previousLoginAt, today, timeZone)} facts={returnFacts} />
        ) : null}

        {generatedOccurrences.length > 0 ? (
          <GeneratedOccurrencesBanner
            descriptions={generatedOccurrences.map((t) => t.description)}
          />
        ) : null}

        <VariableAmountPrompt items={variableAmountPrompts} />
        <IncomeConfirmPrompt items={incomeConfirmPrompts} />

        {safeToSpendResult.error ? (
          sectionError("Safe to spend")
        ) : safeToSpendResult.data ? (
          <SafeToSpendHero data={safeToSpendResult.data} />
        ) : null}

        {showTiles ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {netWorthStatResult.error ? (
              // Full row: a half-width tile squeezes the notice and its
              // retry to a word per line on a phone.
              pageLevelError ? null : (
                <div className="col-span-2 lg:col-span-4">
                  <SectionError label="Net worth" />
                </div>
              )
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
          </div>
        ) : null}

        {showPanels ? (
          <div className="flex flex-col gap-4">
            {/* Budgets and Goals pair up; Upcoming takes its own full-width
                row below -- its rows carry the longest names on the page
                ("Payment to Active Cash Visa Card") plus a date and an
                amount, and a third of the width truncates them. */}
            {showMeters ? (
              <div className="flex flex-col gap-4 lg:flex-row">
                {budgetResult.error ? (
                  pageLevelError ? null : (
                    <div className="min-w-0 lg:flex-1 lg:basis-0">
                      <SectionError label="Budgets" />
                    </div>
                  )
                ) : topBudgets.length > 0 ? (
                  <div className="min-w-0 lg:flex-1 lg:basis-0">
                    <BudgetMeters budgets={topBudgets} />
                  </div>
                ) : null}
                {goalResult.error ? (
                  pageLevelError ? null : (
                    <div className="min-w-0 lg:flex-1 lg:basis-0">
                      <SectionError label="Goals" />
                    </div>
                  )
                ) : activeGoals.length > 0 ? (
                  <div className="min-w-0 lg:flex-1 lg:basis-0">
                    <GoalMeters goals={activeGoals} />
                  </div>
                ) : null}
              </div>
            ) : null}
            {recurringResult.error ? (
              sectionError("Upcoming")
            ) : upcoming !== null && upcoming.items.length > 0 ? (
              <UpcomingList
                data={upcoming}
                unconfirmedIncome={safeToSpendResult.data?.unconfirmedIncome ?? []}
                schedules={upcomingSchedules}
              />
            ) : null}
          </div>
        ) : null}
      </section>

      {/* ── Over time: everything the date-range filter scopes ── */}
      <ScopedRegion range={range}>
        {rangeStatsResult.error ? (
          sectionError("Income and spending")
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
          sectionError("Cash flow")
        ) : showTrend && cashflow ? (
          <CashflowChart points={cashflow} shadeFrom={range.from} shadeTo={range.to} />
        ) : null}

        {movementResult.error ? (
          sectionError("Category movement")
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
