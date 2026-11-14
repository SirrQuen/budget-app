import Link from "next/link";
import { listTransactions, TRANSACTIONS_PAGE_SIZE } from "@/lib/db/transactions";
import { listCategories, listCategoriesForType } from "@/lib/db/categories";
import { listAccounts } from "@/lib/db/accounts";
import { listGoalOptions } from "@/lib/db/goals";
import { LoadError } from "@/components/ui/LoadError";
import { InfoIcon } from "@/components/ui/icons";
import { FIELD_EDGE } from "@/components/ui/Input";
import { getSameBillDeletePreviews } from "@/lib/db/sameBill";
import { sameBillDeleteNotes } from "@/lib/sameBill";
import {
  hasActiveFilters,
  MAX_SEARCH_LENGTH,
  parsePage,
  parseTransactionFilters,
  type SearchParams,
} from "@/lib/transactionFilters";
import { AddTransactionForm } from "./AddTransactionForm";
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
  // On an account page the account is the page; a stray ?accountid= is ignored.
  if (lockedAccountId) filters.accountid = "";
  const page = parsePage(searchParams);
  const accountid = lockedAccountId ?? filters.accountid;

  const [
    transactionsResult,
    categoriesResult,
    accountsResult,
    incomeCategoriesResult,
    expenseCategoriesResult,
    goalsResult,
  ] = await Promise.all([
    listTransactions({
      ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
      ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
      ...(filters.categoryid ? { categoryid: filters.categoryid } : {}),
      ...(accountid ? { accountid } : {}),
      ...(filters.type ? { transaction_type: filters.type } : {}),
      ...(filters.q ? { q: filters.q } : {}),
      page,
    }),
    listCategories(),
    listAccounts(),
    listCategoriesForType("Income"),
    listCategoriesForType("Expense"),
    listGoalOptions(),
  ]);

  if (
    transactionsResult.error !== null ||
    categoriesResult.error !== null ||
    accountsResult.error !== null ||
    incomeCategoriesResult.error !== null ||
    expenseCategoriesResult.error !== null ||
    goalsResult.error !== null
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
  const categories = categoriesResult.data;
  const accounts = accountsResult.data;
  const activeAccounts = accounts.filter((a) => a.is_active);
  const totalPages = Math.max(1, Math.ceil(totalCount / TRANSACTIONS_PAGE_SIZE));
  const hasFilters = hasActiveFilters(filters);

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
          prefill={lockedAccountId ? { accountid: lockedAccountId } : undefined}
        />
      ) : null}

      <form
        action={basePath}
        role="search"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-hairline bg-surface p-4"
      >
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
        canLog={canAddHere}
        accounts={activeAccounts}
        incomeCategories={incomeCategoriesResult.data}
        expenseCategories={expenseCategoriesResult.data}
        goals={goalsResult.data}
        deleteNotes={deleteNotes}
      />
    </div>
  );
}
