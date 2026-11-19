import { recordLogin } from "@/lib/db/profile";
import { isFirstSession } from "@/lib/auth/firstSession";
import { welcomeMessage } from "@/lib/displayName";
import { markStateAt, seasonAt, timeBandAt } from "@/lib/timeOfDay";
import { TimeOfDayGlow } from "@/components/TimeOfDayGlow";
import { YourSorrelLink } from "./YourSorrelLink";
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
  getIncomeSchedules,
} from "@/lib/db/dashboard";
import { getUser } from "@/lib/auth/dal";
import { listCategoriesForType } from "@/lib/db/categories";
import { onboardingStep } from "@/lib/onboarding";
import { PAYDAY_SKIP_COOKIE } from "@/lib/paydaySkip";
import { billsCardDismissToken, billsCardDismissed, paydaySkipToken, paydaySkipped } from "@/lib/paydaySkipToken";
import { isSpendableAccountType } from "@/lib/safeToSpend";
import { OnboardingFlow } from "./OnboardingFlow";
import { BillsCard } from "./BillsCard";
import { getBillsFormLists, getFirstAccountCreatedAt } from "@/lib/db/billsPrompt";
import { addedBillKeys, billsCardVisible } from "@/lib/billsPrompt";
import { BILLS_CARD_DISMISS_COOKIE } from "@/lib/billsCardDismiss";
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
import { cookies } from "next/headers";
import { MonthRecap } from "./MonthRecap";
import { getMonthStory } from "@/lib/db/monthStory";
import { buildRecapCards, recapCookieName, recapMonthFor, shareLines, shareTitle } from "@/lib/monthStory";
import { ScopedRegion } from "./ScopedRegion";
import { CashflowChart } from "./CashflowChart";
import { GroupMovementChart } from "./GroupMovementChart";
import { BudgetMeters } from "./BudgetMeters";
import { AccountActivity } from "./AccountActivity";
import { GoalMeters } from "./GoalMeters";
import { UpcomingList, type UpcomingScheduleMeta } from "./UpcomingList";
import { buildUpcomingOccurrences } from "@/lib/upcomingOccurrences";
import { getSameBillPairs } from "@/lib/db/sameBill";
import { getEarnedMilestoneIds } from "@/lib/db/milestones";
import { MilestoneToast } from "./MilestoneToast";
import {
  DashboardLayoutFooter,
  DashboardLayoutProvider,
  RegionGate,
} from "./DashboardLayoutProvider";
import { DashboardSections } from "./DashboardSections";
import { SectionError } from "./SectionError";
import { LoadError } from "@/components/ui/LoadError";
import { NoTransactionsView } from "./DashboardOnboarding";
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

  // The month recap (lib/monthStory.ts): last month, in the first 7 days of
  // this one, until Done or close sets its month's cookie (client-side).
  // Reading the cookie is all a render does. In development only, a preview
  // month can be asked for; the module that reads it is never bundled by
  // `next build` (lib/recapPreview.ts, `npm run check:recap-preview`).
  let previewMonth: string | null = null;
  if (process.env.NODE_ENV === "development") {
    const { recapPreviewMonth } = await import("@/lib/recapPreview");
    previewMonth = recapPreviewMonth(params, process.env.NODE_ENV);
  }
  const recapMonth = previewMonth ?? recapMonthFor(today);
  const recapSeen = recapMonth !== null && previewMonth === null && (await cookies()).has(recapCookieName(recapMonth));
  const storyPromise = recapMonth !== null && !recapSeen ? getMonthStory(recapMonth) : Promise.resolve(null);
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
    storyResult,
    milestonesResult,
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
    // Only in the recap window, and only until it's dismissed.
    storyPromise,
    // Which lifetime milestones are earned -- no dates, three queries in all
    // (the dates load when the Your Sorrel panel opens); this device decides
    // which are new.
    getEarnedMilestoneIds(),
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

  // Onboarding (docs/Decide-and-Grow.md, G): which step is derived from what
  // exists plus this user's skip cookie -- never a stored flag
  // (lib/onboarding.ts). Only the no-accounts and no-transactions stages can
  // show it, so anyone who has logged anything never does. A failed income
  // read counts as "has a paycheck": better no step 2 than one shown to
  // someone who already has one.
  if (stage === "no-accounts" || stage === "no-transactions") {
    const user = await getUser();
    const userId = user?.id ?? "";
    const [income, firstAccountCreatedAt] =
      stage === "no-transactions" ? await Promise.all([getIncomeSchedules(), getFirstAccountCreatedAt()]) : [null, null];
    const step = onboardingStep({
      stage,
      firstAccountCreatedAt,
      anyIncome: income?.data?.anyIncome ?? true,
      skippedPayday: paydaySkipped((await cookies()).get(PAYDAY_SKIP_COOKIE)?.value, userId),
    });

    if (step !== null) {
      const [categories, billsLists] = step === 2
        ? await Promise.all([listCategoriesForType("Income"), getBillsFormLists()])
        : [null, null];
      const incomeCategories = (categories?.data ?? []).map((c) => ({ id: c.id, name: c.category_name }));
      const paychecks = incomeCategories.find((c) => c.name === "Paychecks/Salary");
      const accounts = (balancesResult.data ?? []).flatMap((a) =>
        a.account_id && a.account_name && a.account_type && isSpendableAccountType(a.account_type)
          ? [{ id: a.account_id, name: a.account_name }]
          : [],
      );
      return (
        <>
          <WelcomeReady />
          {/* One component in one place for both steps, so it keeps its state
              as step 1's save re-renders the page into step 2. */}
          <OnboardingFlow
            step={step}
            welcome={welcome}
            accounts={accounts}
            incomeCategories={incomeCategories}
            defaultCategoryId={paychecks?.id ?? null}
            skipToken={paydaySkipToken(userId)}
            billsLists={billsLists}
          />
        </>
      );
    }
  }

  // The bills card, for someone new who tapped "Later" at step 3 -- or
  // anyone new still short of three bills (docs/Decide-and-Grow.md, G,
  // addition). Derived: recurring expenses (category schedules, not
  // transfers; v_upcoming_recurring holds active ones), the first account's
  // age, and this user's dismiss cookie. Its lists load only when it shows.
  const billsUser = await getUser();
  const billsUserId = billsUser?.id ?? "";
  const expenseScheduleNames = (recurringResult.data ?? [])
    .filter((r) => r.category_type === "Expense" && r.to_accountid === null)
    .map((r) => r.description ?? "");
  const showBillsCard =
    recurringResult.error === null &&
    billsCardVisible({
      firstAccountCreatedAt: await getFirstAccountCreatedAt(),
      timeZone,
      today,
      expenseSchedules: expenseScheduleNames.length,
      dismissed: billsCardDismissed((await cookies()).get(BILLS_CARD_DISMISS_COOKIE)?.value, billsUserId),
    });
  const billsCardLists = showBillsCard ? await getBillsFormLists() : null;
  const billsCard = billsCardLists ? (
    <BillsCard
      lists={billsCardLists}
      added={[...addedBillKeys(expenseScheduleNames)]}
      dismissToken={billsCardDismissToken(billsUserId)}
    />
  ) : null;

  if (stage === "no-transactions") {
    return (
      <>
        <WelcomeReady />
        <NoTransactionsView
          billsCard={billsCard}
          welcome={welcome}
          accounts={balancesResult.data ?? []}
          accountsError={balancesResult.error}
          netWorth={netWorthResult.data?.net_worth ?? null}
          netWorthError={netWorthResult.error}
          safeToSpend={safeToSpendResult.data}
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
  // Account labels for the timeline's day detail, from rows already read:
  // the schedule's own account and a transfer's destination.
  const accountNameById = new Map(
    (balancesResult.data ?? []).flatMap((a) => (a.account_id && a.account_name ? [[a.account_id, a.account_name] as const] : [])),
  );
  const accountLabel = (fromId: string | null, toId: string | null, toName: string | null) => {
    const from = fromId ? (accountNameById.get(fromId) ?? null) : null;
    const to = toId ? (toName ?? accountNameById.get(toId) ?? null) : null;
    return from && to ? `${from} → ${to}` : from;
  };
  const upcomingSchedules: Record<string, UpcomingScheduleMeta> = Object.fromEntries(
    (recurringResult.data ?? []).map((r) => [
      r.recurring_id ?? "",
      {
        categoryIcon: r.category_icon,
        isTransfer: r.to_accountid !== null,
        accountName: accountLabel(r.accountid, r.to_accountid, r.to_account_name),
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
      {
        categoryIcon: t.categoryIcon,
        isTransfer: t.kind === "Transfer",
        accountName: accountLabel(t.accountId, t.toAccountId, null),
        confirm: null,
      },
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
        today={today}
        tightestDate={safeToSpendResult.data?.trough.date ?? today}
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
  // A failed read of either is no recap (or no closing card), never a
  // guessed figure. Safe to spend is today's, the same the hero shows.
  const story = storyResult?.data ?? null;
  const recapCards = story
    ? buildRecapCards(story, safeToSpendResult.error ? null : (safeToSpendResult.data?.safeToSpend ?? null))
    : null;

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
        {/* A failed read is no toast, never an error. */}
        {milestonesResult.data ? (
          <MilestoneToast earned={milestonesResult.data} />
        ) : null}
        {story && recapCards ? (
          <MonthRecap
            cards={recapCards}
            cookieName={recapCookieName(story.monthStart)}
            shareTitle={shareTitle(story)}
            shareLinesHidden={shareLines(recapCards, false)}
            shareLinesShown={shareLines(recapCards, true)}
            fileName={`sorrel-${story.monthStart.slice(0, 7)}.png`}
            preview={previewMonth !== null}
          />
        ) : null}
        {/* ── Right now: as-of-today and forward-looking; not scoped by the filter ── */}
        <section className="flex flex-col gap-6" aria-labelledby="dash-right-now">
          <PageHeader title="Dashboard" description={welcome} descriptionAfter={<YourSorrelLink season={season} />} />
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

          {billsCard}

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
