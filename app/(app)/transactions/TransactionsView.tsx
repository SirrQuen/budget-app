import Link from "next/link";
import { listFlowRows, listTransactions, TRANSACTIONS_PAGE_SIZE } from "@/lib/db/transactions";
import { getToday } from "@/lib/db/settings";
import { summarizeFlow } from "@/lib/flowSummary";
import { listCategories, listCategoriesForType } from "@/lib/db/categories";
import { listAccounts } from "@/lib/db/accounts";
import { listFollowedGoals, listGoalOptions } from "@/lib/db/goals";
import { LoadError } from "@/components/ui/LoadError";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { InfoIcon } from "@/components/ui/icons";
import { FIELD_EDGE } from "@/components/ui/Input";
import { getBudgetsForMonth } from "@/lib/db/budgets";
import { formatMonthYear } from "@/lib/budgetMonth";
import { formatCurrency } from "@/lib/format";
import { getSameBillDeletePreviews } from "@/lib/db/sameBill";
import { sameBillDeleteNotes } from "@/lib/sameBill";
import { getTransferOrigins } from "@/lib/db/transferConversions";
import { exportLabel } from "@/lib/transactionExport";
import {
  activeFlowScope,
  budgetDrillMonth,
  buildListHref,
  hasActiveFilters,
  listReadOptions,
  MAX_SEARCH_LENGTH,
  narrowsFlow,
  periodLabels,
  parsePage,
  parseTransactionFilters,
  type SearchParams,
} from "@/lib/transactionFilters";
import { AddTransactionForm } from "./AddTransactionForm";
import { FlowSummaryCard } from "./FlowSummaryCard";
import { TransactionsList } from "./TransactionsList";

// The one filterable transaction list. /transactions and /accounts/[id] both
// render this -- the account page is the same list with its account fixed --
// so the two can't drift apart. Filters live in the URL (lib/
// transactionFilters.ts): account, category, type, date range, text.

// max-w-full: a <select> sizes to its longest option, so one long category
// or account name otherwise pushes the card past a 320px viewport.
const FILTER_FIELD = `max-w-full ${FIELD_EDGE} bg-surface-raised px-3 py-2 text-sm text-ink`;
const LABEL = "text-sm font-medium text-ink-secondary";

export async function TransactionsView({
  searchParams,
  basePath,
  lockedAccountId,
}: {
  searchParams: SearchParams;
  /** "/transactions", or "/accounts/<id>". The filter form and every link stay on it. */
  basePath: string;
  /** Account page: the list is this account's, and new transactions start on it. */
  lockedAccountId?: string;
}) {
  const filters = parseTransactionFilters(searchParams);
  // On an account page the account is the page; a stray ?accountid= is ignored,
  // as is a tile's flow, which belongs to /transactions.
  if (lockedAccountId) {
    filters.accountid = "";
    filters.flow = "";
    filters.period = "";
  }
  const page = parsePage(searchParams);
  const accountid = lockedAccountId ?? filters.accountid;
  // A budget's drill-down reads the budget's own rule -- Expense, no transfer
  // legs, this category, this month -- and its total comes from the same
  // function the Budgets page does, never a sum made here.
  const drillMonth = lockedAccountId ? null : budgetDrillMonth(filters);
  // A dashboard tile's drill-down: the tile's scope, which the other filters
  // only narrow. The summary reads the whole scope, and again as narrowed.
  const today = await getToday();
  const flowScope = activeFlowScope(filters, today);
  const narrowed = flowScope !== null && narrowsFlow(filters);

  const [
    transactionsResult,
    categoriesResult,
    accountsResult,
    incomeCategoriesResult,
    expenseCategoriesResult,
    goalsResult,
    followedGoalsResult,
    drillBudgetsResult,
    flowRowsResult,
    narrowedRowsResult,
  ] = await Promise.all([
    listTransactions({
      ...listReadOptions({ ...filters, accountid }, today),
      ...(drillMonth ? { excludeTransfers: true } : {}),
      page,
    }),
    listCategories(),
    listAccounts(),
    listCategoriesForType("Income"),
    listCategoriesForType("Expense"),
    listGoalOptions(),
    listFollowedGoals(),
    drillMonth ? getBudgetsForMonth(drillMonth) : Promise.resolve(null),
    flowScope
      ? listFlowRows(listReadOptions({ flow: filters.flow, period: filters.period }, today))
      : Promise.resolve(null),
    narrowed ? listFlowRows(listReadOptions(filters, today)) : Promise.resolve(null),
  ]);

  if (
    transactionsResult.error !== null ||
    categoriesResult.error !== null ||
    accountsResult.error !== null ||
    incomeCategoriesResult.error !== null ||
    expenseCategoriesResult.error !== null ||
    goalsResult.error !== null ||
    // A tile's drill-down without its total would be half an answer.
    (flowRowsResult !== null && flowRowsResult.error !== null) ||
    (narrowedRowsResult !== null && narrowedRowsResult.error !== null)
  ) {
    return (
      <LoadError
        message={
          transactionsResult.error ??
          categoriesResult.error ??
          accountsResult.error ??
          incomeCategoriesResult.error ??
          expenseCategoriesResult.error ??
          goalsResult.error ??
          flowRowsResult?.error ??
          narrowedRowsResult?.error ??
          "We couldn't load your transactions. Refresh the page to try again."
        }
      />
    );
  }

  const { transactions, totalCount, truncation } = transactionsResult.data;
  // Only a linked row can carry a "same bill" answer. A failed read loses
  // only the note; the delete trigger still restores when it can.
  const previewsResult = await getSameBillDeletePreviews(
    transactions.filter((t) => t.recurringid !== null).map((t) => t.id),
  );
  const deleteNotes = sameBillDeleteNotes(previewsResult.data ?? []);
  // Transfers made from an entry or joined by an import: their delete
  // names both entries and offers "Separate them instead" (migration 80).
  // A failed read leaves the plain dialog.
  const originsResult = await getTransferOrigins(
    transactions.map((t) => t.transfer_group_id).filter((g): g is string => g !== null),
  );
  const deleteOrigins = Object.fromEntries(originsResult.data ?? []);
  const categories = categoriesResult.data;
  const accounts = accountsResult.data;
  const activeAccounts = accounts.filter((a) => a.is_active);
  const totalPages = Math.max(1, Math.ceil(totalCount / TRANSACTIONS_PAGE_SIZE));
  const hasFilters = hasActiveFilters(filters);
  // The list's own count: its units (a transfer is one), or, when the read
  // hit the project's row ceiling, the matching rows it couldn't reach.
  const exportCount = truncation ? truncation.transactionsTotal : totalCount;

  // The budget's own figure for this category and month, or nothing when
  // the budget can't be read -- the list still stands without its header.
  const drillBudget =
    drillMonth && drillBudgetsResult?.data
      ? (drillBudgetsResult.data.find((b) => b.category_id === filters.categoryid) ?? null)
      : null;
  const drillCategoryName =
    drillBudget?.category_name ?? categories.find((c) => c.id === filters.categoryid)?.category_name ?? "this category";
  const budgetDrill = drillMonth
    ? { categoryName: drillCategoryName, monthLabel: formatMonthYear(drillMonth) }
    : undefined;

  const flowSummary = flowRowsResult?.data ? summarizeFlow(flowRowsResult.data) : null;
  const flowLabels = flowScope ? periodLabels(filters.period, today) : null;

  const incomeCategories = categories.filter((c) => c.category_type === "Income");
  const expenseCategories = categories.filter((c) => c.category_type === "Expense");
  // An archived account's page still lists its history, but nothing new can
  // be logged against it.
  const canAddHere = lockedAccountId
    ? activeAccounts.some((a) => a.id === lockedAccountId)
    : activeAccounts.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {activeAccounts.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-hairline bg-surface px-4 py-3">
          <p className="text-sm text-ink-secondary">
            Add an account before you can log a transaction.
          </p>
          <Link
            href="/accounts"
            className="rounded text-sm font-medium text-action transition-colors duration-150 hover:text-action-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Add your first account
          </Link>
        </div>
      ) : canAddHere ? (
        <AddTransactionForm
          incomeCategories={incomeCategoriesResult.data}
          expenseCategories={expenseCategoriesResult.data}
          accounts={activeAccounts}
          goals={goalsResult.data}
          followedGoals={followedGoalsResult.data ?? []}
          prefill={lockedAccountId ? { accountid: lockedAccountId } : undefined}
        />
      ) : null}

      {drillMonth && drillBudget ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold text-ink">
            {drillCategoryName} · {formatMonthYear(drillMonth)} · {formatCurrency(drillBudget.actual_spend ?? 0)} spent
          </h2>
          <Link
            href={`/budgets?month=${drillMonth}`}
            className="inline-flex min-h-11 items-center rounded text-sm font-medium text-action transition-colors duration-150 hover:text-action-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page"
          >
            ← Back to budgets
          </Link>
        </div>
      ) : null}

      {flowScope && flowSummary && flowLabels ? (
        <FlowSummaryCard
          scope={flowScope}
          period={filters.period}
          labels={flowLabels}
          summary={flowSummary}
          narrowed={narrowedRowsResult?.data ? summarizeFlow(narrowedRowsResult.data) : null}
          clearHref={basePath}
          category={
            filters.categoryid
              ? {
                  // The summary names archived categories too.
                  name:
                    flowSummary.categories.find((c) => c.categoryid === filters.categoryid)?.name ??
                    categories.find((c) => c.id === filters.categoryid)?.category_name ??
                    "Category",
                  clearHref: buildListHref(basePath, filters, { categoryid: "" }),
                }
              : null
          }
        />
      ) : null}

      <form
        action={basePath}
        role="search"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-hairline bg-surface p-4"
      >
        {/* A tile's drill-down stays one while it's searched or narrowed. */}
        {flowScope ? (
          <>
            <input type="hidden" name="flow" value={filters.flow} />
            <input type="hidden" name="period" value={filters.period} />
          </>
        ) : null}

        <div className="flex min-w-0 max-w-full flex-col gap-1.5">
          <label htmlFor="filter-q" className={LABEL}>
            Search
          </label>
          <input
            id="filter-q"
            name="q"
            type="search"
            maxLength={MAX_SEARCH_LENGTH}
            defaultValue={filters.q || undefined}
            placeholder="Description, note, category, account, or amount"
            className={`${FILTER_FIELD} w-72`}
          />
        </div>

        <div className="flex min-w-0 max-w-full flex-col gap-1.5">
          <label htmlFor="filter-dateFrom" className={LABEL}>
            From
          </label>
          <input
            id="filter-dateFrom"
            name="dateFrom"
            type="date"
            defaultValue={filters.dateFrom || undefined}
            className={FILTER_FIELD}
          />
        </div>

        <div className="flex min-w-0 max-w-full flex-col gap-1.5">
          <label htmlFor="filter-dateTo" className={LABEL}>
            To
          </label>
          <input
            id="filter-dateTo"
            name="dateTo"
            type="date"
            defaultValue={filters.dateTo || undefined}
            className={FILTER_FIELD}
          />
        </div>

        <div className="flex min-w-0 max-w-full flex-col gap-1.5">
          <label htmlFor="filter-categoryid" className={LABEL}>
            Category
          </label>
          <select
            id="filter-categoryid"
            name="categoryid"
            defaultValue={filters.categoryid}
            className={FILTER_FIELD}
          >
            <option value="">All categories</option>
            {incomeCategories.length > 0 ? (
              <optgroup label="Income">
                {incomeCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.category_name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {expenseCategories.length > 0 ? (
              <optgroup label="Expense">
                {expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.category_name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </div>

        {/* On an account's page the account is the page, not a filter. */}
        {lockedAccountId ? null : (
          <div className="flex min-w-0 max-w-full flex-col gap-1.5">
            <label htmlFor="filter-accountid" className={LABEL}>
              Account
            </label>
            <select
              id="filter-accountid"
              name="accountid"
              defaultValue={filters.accountid}
              className={FILTER_FIELD}
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_name}
                  {a.is_active ? "" : " (archived)"}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Income or Spending already says which. */}
        {flowScope ? null : (
          <div className="flex min-w-0 max-w-full flex-col gap-1.5">
            <label htmlFor="filter-type" className={LABEL}>
              Type
            </label>
            <select id="filter-type" name="type" defaultValue={filters.type} className={FILTER_FIELD}>
              <option value="">All</option>
              <option value="Income">Income</option>
              <option value="Expense">Expense</option>
            </select>
          </div>
        )}

        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-full bg-action px-4 py-2 text-sm font-semibold text-action-ink transition-all duration-150 ease-out hover:-translate-y-0.5 hover:bg-action-hover hover:shadow-md active:translate-y-0 active:scale-[0.97] active:bg-action-pressed active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Filter
        </button>

        {hasFilters ? (
          <Link
            href={basePath}
            className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Clear filters
          </Link>
        ) : null}
      </form>

      {/* Exactly what the filters above select -- every matching row, not
          just this page. A plain link, not a form: it only reads, and the
          route's Content-Disposition makes the file (no `download`
          attribute: on a failure the route redirects back here). The count
          is the list's own. Not on an account's page, whose list is fixed. */}
      {lockedAccountId || exportCount === 0 ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={buildListHref("/transactions/export", filters)}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-field-border px-4 py-2 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {exportLabel(hasFilters, exportCount)}
          </a>
          {searchParams.export === "failed" ? (
            <ErrorMessage
              severity="critical"
              message="We couldn't make that export just now. Your data is fine. Try the button again."
            />
          ) : null}
        </div>
      )}

      {truncation ? (
        <p
          role="status"
          className="flex items-start gap-3 rounded-xl border border-hairline bg-surface-raised px-4 py-3 text-sm font-medium text-ink"
        >
          <InfoIcon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
          <span>
            Showing your most recent {truncation.transactionsShown.toLocaleString("en-US")} of{" "}
            {truncation.transactionsTotal.toLocaleString("en-US")} transactions. Narrow the date
            range above to see older ones.
          </span>
        </p>
      ) : null}

      <TransactionsList
        transactions={transactions}
        totalCount={totalCount}
        page={page}
        totalPages={totalPages}
        pageSize={TRANSACTIONS_PAGE_SIZE}
        filters={filters}
        basePath={basePath}
        lockedAccountId={lockedAccountId}
        hasFilters={hasFilters}
        budgetDrill={budgetDrill}
        flowEmpty={
          flowScope && flowSummary?.count === 0 && flowLabels
            ? { flow: flowScope.flow, phrase: flowLabels.phrase }
            : undefined
        }
        canLog={canAddHere}
        accounts={activeAccounts}
        incomeCategories={incomeCategoriesResult.data}
        expenseCategories={expenseCategoriesResult.data}
        goals={goalsResult.data}
        deleteNotes={deleteNotes}
        deleteOrigins={deleteOrigins}
      />
    </div>
  );
}
