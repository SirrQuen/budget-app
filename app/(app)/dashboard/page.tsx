import { recordLogin } from "@/lib/db/profile";
import { isFirstSession } from "@/lib/auth/firstSession";
import { welcomeMessage } from "@/lib/displayName";
import { markStateAt, seasonAt, timeBandAt } from "@/lib/timeOfDay";
import { TimeOfDayGlow } from "@/components/TimeOfDayGlow";
import { SeasonalLeaf } from "@/components/SeasonalLeaf";
import {
  getDashboardOnboarding,
  classifyDashboardStage,
  getSafeToSpend,
  getNetWorth,
  getNetWorthStat,
  getRangeCashflowStats,
  getCashflowChart,
  getGroupMovement,
  getGoalProgress,
  getUpcomingRecurring,
  getConfirmationQueue,
  getFutureTransactions,
} from "@/lib/db/dashboard";
import { getBudgetsForMonth } from "@/lib/db/budgets";
import { getAccountLastLogged, listAccountBalances } from "@/lib/db/accounts";
import { getReturnSummaryFacts } from "@/lib/actions/activity";
import { isAwaitingStatementAmount } from "@/lib/recurringSchedule";
import type { VariableAmountTarget } from "../recurring/ConfirmVariableAmountSheet";
import { resolveDashboardRange } from "@/lib/dashboardRange";
import { getDashboardLayout, getTimeZone, getToday } from "@/lib/db/settings";
import {
  DASHBOARD_SECTIONS,
  type DashboardRegion,
  type DashboardSectionId,
} from "@/lib/dashboardLayout";
import { sinceLabel } from "@/lib/sinceLabel";
import { monthStartISO } from "@/lib/date";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import { ReturnSummaryStrip } from "@/components/ui/ReturnSummaryStrip";
import { VariableAmountPrompt } from "./VariableAmountPrompt";
import { ConfirmationQueue } from "../recurring/ConfirmationQueue";
import { SafeToSpendHero } from "./SafeToSpendHero";
import { WhatsNewCard } from "./WhatsNewCard";
import { whatsNewVisible } from "@/lib/whatsNew";
import { getWhatsNewSeen } from "@/lib/whatsNewDismissed";
import { ScopedRegion } from "./ScopedRegion";
import { CashflowChart } from "./CashflowChart";
import { GroupMovementChart } from "./GroupMovementChart";
import { BudgetMeters } from "./BudgetMeters";
import { AccountActivity } from "./AccountActivity";
import { GoalMeters } from "./GoalMeters";
import { UpcomingList, type UpcomingScheduleMeta } from "./UpcomingList";
import { buildUpcomingOccurrences } from "@/lib/upcomingOccurrences";
import { getSameBillPairs } from "@/lib/db/sameBill";
import {
  DashboardLayoutFooter,
  DashboardLayoutProvider,
  RegionGate,
} from "./DashboardLayoutProvider";
import { DashboardSections } from "./DashboardSections";
import { SectionError } from "./SectionError";
import { LoadError } from "@/components/ui/LoadError";
import { NoAccountsView, NoTransactionsView } from "./DashboardOnboarding";
import { DayNightMark } from "@/components/DayNightMark";
import { WelcomeReady } from "@/components/WelcomeReady";

// Auth is already enforced by app/(app)/layout.tsx's requireUser() before
// this page renders.
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const params = await searchParams;
  const [today, timeZone] = await Promise.all([getToday(), getTimeZone()]);
  // The band and the season are the user's own hour and month, in
  // settings.timezone (lib/timeOfDay.ts). The instant is the only thing read
  // from the process clock; the zone, never the server's, decides what it means.
  const renderedAt = new Date();
  const band = timeBandAt(timeZone, renderedAt);
  const season = seasonAt(timeZone, renderedAt);
  const range = resolveDashboardRange(params, today);
  // Read-only: a cookie says whether "Got it" was pressed. Nothing is written on render.
  const showWhatsNew = whatsNewVisible(today, await getWhatsNewSeen());
  // Never throws: an unreadable layout is the default one.
  const layout = await getDashboardLayout();
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

  // One batch, all in flight together. A brand-new user (stages 1-2) fetches
  // a few results it won't render -- all cheap and empty -- which is the price
  // of not adding a waterfall for the common full-dashboard case.
  const [
    greetingResult,
    firstSession,
    onboardingResult,
    safeToSpendResult,
    netWorthStatResult,
    budgetResult,
    goalResult,
    recurringResult,
    confirmationResult,
    returnFacts,
    rangeStatsResult,
    cashflowResult,
    movementResult,
    balancesResult,
    netWorthResult,
    lastLoggedResult,
    futureResult,
    sameBillResult,
  ] = await Promise.all([
    greetingPromise,
    // Decided when the session started -- see lib/auth/firstSession.ts.
    isFirstSession(),
    getDashboardOnboarding(),
    getSafeToSpend(),
    getNetWorthStat(),
    getBudgetsForMonth(currentMonth),
    getGoalProgress(),
    getUpcomingRecurring(),
    getConfirmationQueue(),
    returnFactsPromise,
    getRangeCashflowStats(range),
    getCashflowChart(),
    getGroupMovement(range),
    listAccountBalances({ is_active: true }),
    getNetWorth(),
    getAccountLastLogged(),
    // cache()d -- the same rows getSafeToSpend counted, for their icons.
    getFutureTransactions(),
    // A schedule's occurrence and an entry for the same bill: asked, in
    // Upcoming, where both would otherwise be listed (lib/sameBill.ts).
    getSameBillPairs(),
  ]);

  // A failed profile read just means no name -- "Welcome back" alone.
  const welcome = welcomeMessage(greetingResult.data ?? {}, firstSession, band);
  const previousLoginAt = greetingResult.data?.previousLoginAt ?? null;

  // If the snapshot itself failed we can't tell which stage the user is in --
  // fall through to the full dashboard, where the per-section error handling
  // surfaces whatever's actually broken. A wrong welcome screen would be worse.
  const stage = onboardingResult.data
    ? classifyDashboardStage(onboardingResult.data, today)
    : "full";

  if (stage === "no-accounts") {
    return (
      <>
        <WelcomeReady />
        <NoAccountsView welcome={welcome} />
      </>
    );
  }

  if (stage === "no-transactions") {
    return (
      <>
        <WelcomeReady />
        <NoTransactionsView
          welcome={welcome}
          accounts={balancesResult.data ?? []}
          accountsError={balancesResult.error}
          netWorth={netWorthResult.data?.net_worth ?? null}
          netWorthError={netWorthResult.error}
        />
      </>
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

  // budget_progress_for_month is ordered status_rank desc (problems first),
  // and includes budgets carried from an earlier month (migration 63).
  const topBudgets =
    budgetResult.data?.slice(0, 3) ?? [];
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
        // The card's statement amount -- a revision of the expectation,
        // never a transaction (that's the confirmation queue's job).
        confirm:
          r.next_due_date != null && r.to_accountid !== null && r.is_estimated_amount
            ? {
                kind: "card" as const,
                dueDate: r.next_due_date,
                target: {
                  id: r.recurring_id ?? "",
                  cardName: r.to_account_name ?? "the card",
                  estimatedAmount: r.amount ?? 0,
                  statementDay: r.statement_day ?? 1,
                  cursorDate: r.next_run_date ?? "",
                  dueDate: r.next_due_date,
                  anchorDate: r.start_date ?? r.next_run_date ?? "",
                },
              }
            : null,
      },
    ]),
  );

  // One-off transactions dated after today: icon only, never a confirm --
  // the person entered them, so they simply start counting on their date.
  const upcomingFuture: Record<string, UpcomingScheduleMeta> = Object.fromEntries(
    (futureResult.data ?? []).map((t) => [
      t.transactionId,
      { categoryIcon: t.categoryIcon, isTransfer: t.kind === "Transfer", confirm: null },
    ]),
  );

  // Both prompt lists below read recurringResult. On a failed read they're
  // empty, but never silently: the Upcoming section reports the failure.
  //
  // The nudge to enter a card's statement amount runs from the statement
  // date through the adjusted due date (see CLAUDE.md "Prompt timing"). It
  // revises the expected payment; the payment itself goes through the queue
  // -- scanned over the FULL upcoming list, not just the 5-item slice above,
  // so a variable schedule further out still gets its prompt.
  const variableAmountPrompts: VariableAmountTarget[] = (recurringResult.data ?? [])
    .flatMap((r) =>
      r.amount_is_variable === true &&
      r.next_amount_confirmed_at === null &&
      r.statement_day != null &&
      r.next_run_date != null &&
      r.next_due_date != null
        ? [
            {
              id: r.recurring_id ?? "",
              cardName: r.to_account_name ?? "the card",
              estimatedAmount: r.amount ?? 0,
              statementDay: r.statement_day,
              cursorDate: r.next_run_date,
              dueDate: r.next_due_date,
              anchorDate: r.start_date ?? r.next_run_date,
            },
          ]
        : [],
    )
    .filter((target) => isAwaitingStatementAmount(today, target));

  const upcomingError = recurringResult.error ?? safeToSpendResult.error;

  // Every section that renders a SectionError on failure, by its label.
  const failedSections = (
    [
      ["Safe to spend", safeToSpendResult.error],
      ["To confirm", confirmationResult.error],
      ["Net worth", netWorthStatResult.error],
      ["Budgets", budgetResult.error],
      ["Goals", goalResult.error],
      // The list is built from the projection (see `upcoming` above), so a
      // failed safe-to-spend read fails it too. Without this it vanished
      // silently beside the "Safe to spend" notice.
      ["Upcoming", upcomingError],
      ["Income and spending", rangeStatsResult.error],
      ["Cash flow", cashflowResult.error],
      ["Category movement", movementResult.error],
      ["Accounts", balancesResult.error ?? lastLoggedResult.error],
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
    showsError(upcomingError) ||
    (upcoming !== null && upcoming.items.length > 0);

  // Each movable section as its node (null = nothing to show), keyed by the
  // names lib/dashboardLayout.ts stores. The layout decides order and what's
  // hidden; the data decides what has anything to show. The Safe to Spend
  // hero is not here: it is pinned first and can't be hidden.
  const nodes: Record<DashboardSectionId, React.ReactNode> = {
    // Beneath the figure it never changes: an unanswered item is
    // already counted there. Only an answer writes.
    "to-confirm": confirmationResult.error ? (
      sectionError("To confirm")
    ) : confirmationResult.data && confirmationResult.data.length > 0 ? (
      // An empty queue renders nothing, and a section that renders nothing
      // must not be a card: it would be an invisible drop target with
      // floating controls and a gap of its own.
      <ConfirmationQueue items={confirmationResult.data} />
    ) : null,

    // A small tile on its own: the card IS the tile.
    "net-worth": showTiles ? (
      netWorthStatResult.error ? (
        pageLevelError ? null : <SectionError label="Net worth" />
      ) : netWorthStatResult.data ? (
        <StatTile
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
      ) : null
    ) : null,

    budgets: budgetResult.error ? (
      pageLevelError ? null : <SectionError label="Budgets" />
    ) : topBudgets.length > 0 ? (
      <BudgetMeters budgets={topBudgets} />
    ) : null,

    goals: goalResult.error ? (
      pageLevelError ? null : <SectionError label="Goals" />
    ) : activeGoals.length > 0 ? (
      <GoalMeters goals={activeGoals} />
    ) : null,

    upcoming: upcomingError ? (
      sectionError("Upcoming")
    ) : upcoming !== null && upcoming.items.length > 0 ? (
      <UpcomingList
        data={upcoming}
        unconfirmedIncome={safeToSpendResult.data?.unconfirmedIncome ?? []}
        schedules={upcomingSchedules}
        futureTransactions={upcomingFuture}
        // A failed read only loses the question; both rows still show.
        sameBillPairs={sameBillResult.data ?? []}
      />
    ) : null,

    // "Last logged 12 days ago", per account -- a fact, never a nudge.
    accounts: !showPanels ? null : balancesResult.error || lastLoggedResult.error ? (
      sectionError("Accounts")
    ) : (balancesResult.data ?? []).every((a) => a.account_id === null) ? null : (
      <AccountActivity
        accounts={balancesResult.data ?? []}
        lastLogged={lastLoggedResult.data ?? new Map()}
        today={today}
      />
    ),

    // Two small tiles, one section each. A failed read is reported once, on
    // the first of them.
    income: rangeStatsResult.error ? (
      sectionError("Income and spending")
    ) : rangeStats ? (
      <StatTile
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
    ) : null,

    spending: rangeStatsResult.error ? null : rangeStats ? (
      <StatTile
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
    ) : null,

    // The 90-day trend charts render at "full". At "early" they'd be four
    // points of noise, so a plain line stands in for them -- but a real
    // load failure always surfaces in place, even early. The line is this
    // card, so it can be moved or hidden like the chart it stands in for.
    "cash-flow": cashflowResult.error ? (
      sectionError("Cash flow")
    ) : showTrend && cashflow ? (
      <CashflowChart points={cashflow} shadeFrom={range.from} shadeTo={range.to} />
    ) : !showTrend && !movementResult.error ? (
      <p className="rounded-2xl border border-hairline bg-surface px-4 py-3 text-sm text-ink-secondary">
        Your cash-flow trend and category movement need a couple of weeks of history. Keep
        logging and they show up here.
      </p>
    ) : null,

    "category-movement": movementResult.error ? (
      sectionError("Category movement")
    ) : showTrend && movement ? (
      <GroupMovementChart data={movement} />
    ) : null,
  };

  // Every section that has something to show, for its region. Hidden ones
  // are included on purpose: hiding happens on screen, instantly, and Undo
  // has to be able to bring one straight back.
  const itemsFor = (region: DashboardRegion) =>
    DASHBOARD_SECTIONS.filter((section) => section.region === region).flatMap((section) =>
      nodes[section.id] == null ? [] : [{ id: section.id, node: nodes[section.id] }],
    );
  const rightNowItems = itemsFor("right-now");
  const overTimeItems = itemsFor("over-time");
  const available = [...rightNowItems, ...overTimeItems].map((item) => item.id);

  return (
    <DashboardLayoutProvider saved={layout}>
      <div className="relative isolate flex flex-col gap-10">
        {/* Behind everything, static, by the user's local hour. */}
        <TimeOfDayGlow band={band} />
        {/* The data has landed: the daily welcome can dissolve onto this. */}
        <WelcomeReady />
        {/* ── Right now: as-of-today and forward-looking; not scoped by the filter ── */}
        <section className="flex flex-col gap-6" aria-labelledby="dash-right-now">
          <PageHeader title="Dashboard" description={welcome} descriptionAdornment={<SeasonalLeaf season={season} />} />
          {pageLevelError ? <LoadError message="We couldn’t load parts of your dashboard." /> : null}
          {/* The mark is ambient -- day/night for "right now" -- and kept out
              of the hero's row so nothing competes with that figure. */}
          <div className="flex items-center justify-between gap-4">
            <h2 id="dash-right-now" className="text-sm font-medium text-ink-secondary">
              Right now
            </h2>
            <DayNightMark size={56} timeZone={timeZone} initialState={markStateAt(timeZone, renderedAt)} />
          </div>

          {/* LoggingStreakStrip is hidden, not deleted: it counts days with a
              transaction, so a week of spending nothing breaks it. It returns
              on the "opened Sorrel" definition -- see docs/phase-7-findings.md,
              "Streak: redefined as days opened". */}

          {previousLoginAt && returnFacts.length > 0 ? (
            <ReturnSummaryStrip since={sinceLabel(previousLoginAt, today, timeZone)} facts={returnFacts} />
          ) : null}

          <VariableAmountPrompt items={variableAmountPrompts} />

          {/* Pinned: first, always, never draggable or hideable, and
              nothing can be dropped above it. It has no name in the layout. */}
          {safeToSpendResult.error ? (
            sectionError("Safe to spend")
          ) : safeToSpendResult.data ? (
            <SafeToSpendHero data={safeToSpendResult.data} />
          ) : null}

          {/* Directly below the hero, never above it. Not part of the layout:
              not draggable and not hideable from the card menu. */}
          {showWhatsNew ? <WhatsNewCard /> : null}

          <DashboardSections region="right-now" items={rightNowItems} />
        </section>

        {/* ── Over time: everything the date-range filter scopes ── */}
        {overTimeItems.length > 0 ? (
          <RegionGate ids={overTimeItems.map((item) => item.id)}>
            <ScopedRegion range={range}>
              <DashboardSections region="over-time" items={overTimeItems} />
            </ScopedRegion>
          </RegionGate>
        ) : null}

        <DashboardLayoutFooter available={available} />
      </div>
    </DashboardLayoutProvider>
  );
}
