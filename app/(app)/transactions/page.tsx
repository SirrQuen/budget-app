import Link from "next/link";
import {
  listTransactions,
  TRANSACTIONS_PAGE_SIZE,
  type TransactionType,
} from "@/lib/db/transactions";
import { listCategories, listCategoriesForType } from "@/lib/db/categories";
import { listAccounts } from "@/lib/db/accounts";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { ListIcon } from "@/components/ui/icons";
import { formatDate, formatSignedAmount, type Tone } from "@/lib/format";
import { AddTransactionForm } from "./AddTransactionForm";
import { DeleteTransactionButton } from "./DeleteTransactionButton";

type SearchParams = Awaited<PageProps<"/transactions">["searchParams"]>;

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

// Builds a /transactions?... href from the current filters plus overrides
// (e.g. a new page number) -- every filtered, paginated view is just a URL,
// so this stays the only place query strings get assembled.
function buildHref(params: SearchParams, overrides: Record<string, string>) {
  const usp = new URLSearchParams();
  const merged = {
    dateFrom: first(params.dateFrom),
    dateTo: first(params.dateTo),
    categoryid: first(params.categoryid),
    accountid: first(params.accountid),
    type: first(params.type),
    page: first(params.page),
    ...overrides,
  };
  for (const [key, value] of Object.entries(merged)) {
    if (value) usp.set(key, value);
  }
  const qs = usp.toString();
  return `/transactions${qs ? `?${qs}` : ""}`;
}

const toneClass: Record<Tone, string> = {
  good: "text-good",
  critical: "text-critical",
  neutral: "text-ink-muted",
};

export default async function TransactionsPage({
  searchParams,
}: PageProps<"/transactions">) {
  const params = await searchParams;

  const dateFrom = first(params.dateFrom);
  const dateTo = first(params.dateTo);
  const categoryid = first(params.categoryid);
  const accountid = first(params.accountid);
  const type: TransactionType | "" =
    params.type === "Income" || params.type === "Expense" ? params.type : "";
  const pageRaw = Number(first(params.page));
  const page = Number.isFinite(pageRaw) && pageRaw > 1 ? Math.floor(pageRaw) : 1;

  const [
    transactionsResult,
    categoriesResult,
    accountsResult,
    incomeCategoriesResult,
    expenseCategoriesResult,
  ] = await Promise.all([
    listTransactions({
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      ...(categoryid ? { categoryid } : {}),
      ...(accountid ? { accountid } : {}),
      ...(type ? { transaction_type: type } : {}),
      page,
    }),
    listCategories(),
    listAccounts(),
    listCategoriesForType("Income"),
    listCategoriesForType("Expense"),
  ]);

  if (
    transactionsResult.error !== null ||
    categoriesResult.error !== null ||
    accountsResult.error !== null ||
    incomeCategoriesResult.error !== null ||
    expenseCategoriesResult.error !== null
  ) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Transactions" description="Every dollar in and out, newest first." />
        <ErrorMessage
          message={
            transactionsResult.error ??
            categoriesResult.error ??
            accountsResult.error ??
            incomeCategoriesResult.error ??
            expenseCategoriesResult.error ??
            "Failed to load transactions."
          }
        />
      </div>
    );
  }

  const { transactions, totalCount } = transactionsResult.data;
  const categories = categoriesResult.data;
  const accounts = accountsResult.data;
  const activeAccounts = accounts.filter((a) => a.is_active);
  const totalPages = Math.max(1, Math.ceil(totalCount / TRANSACTIONS_PAGE_SIZE));
  const hasFilters = Boolean(dateFrom || dateTo || categoryid || accountid || type);

  const incomeCategories = categories.filter((c) => c.category_type === "Income");
  const expenseCategories = categories.filter((c) => c.category_type === "Expense");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Transactions" description="Every dollar in and out, newest first." />

      {activeAccounts.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-hairline bg-surface px-4 py-3">
          <p className="text-sm text-ink-secondary">
            Add an account before you can log a transaction.
          </p>
          <Link
            href="/accounts"
            className="text-sm font-medium text-gold hover:text-gold-hover hover:underline"
          >
            Add your first account
          </Link>
        </div>
      ) : (
        <AddTransactionForm
          incomeCategories={incomeCategoriesResult.data}
          expenseCategories={expenseCategoriesResult.data}
          accounts={activeAccounts}
        />
      )}

      <form
        action="/transactions"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-hairline bg-surface p-4"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="dateFrom" className="text-sm font-medium text-ink-secondary">
            From
          </label>
          <input
            id="dateFrom"
            name="dateFrom"
            type="date"
            defaultValue={dateFrom || undefined}
            className="rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-gold focus:ring-2 focus:ring-gold/40"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="dateTo" className="text-sm font-medium text-ink-secondary">
            To
          </label>
          <input
            id="dateTo"
            name="dateTo"
            type="date"
            defaultValue={dateTo || undefined}
            className="rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-gold focus:ring-2 focus:ring-gold/40"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="categoryid" className="text-sm font-medium text-ink-secondary">
            Category
          </label>
          <select
            id="categoryid"
            name="categoryid"
            defaultValue={categoryid}
            className="rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-gold focus:ring-2 focus:ring-gold/40"
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

        <div className="flex flex-col gap-1.5">
          <label htmlFor="accountid" className="text-sm font-medium text-ink-secondary">
            Account
          </label>
          <select
            id="accountid"
            name="accountid"
            defaultValue={accountid}
            className="rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-gold focus:ring-2 focus:ring-gold/40"
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

        <div className="flex flex-col gap-1.5">
          <label htmlFor="type" className="text-sm font-medium text-ink-secondary">
            Type
          </label>
          <select
            id="type"
            name="type"
            defaultValue={type}
            className="rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-gold focus:ring-2 focus:ring-gold/40"
          >
            <option value="">All</option>
            <option value="Income">Income</option>
            <option value="Expense">Expense</option>
          </select>
        </div>

        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-full bg-gold px-4 py-2 text-sm font-semibold text-gold-ink transition-colors hover:bg-gold-hover active:bg-gold-pressed"
        >
          Filter
        </button>

        {hasFilters ? (
          <Link
            href="/transactions"
            className="text-sm font-medium text-ink-secondary hover:text-ink"
          >
            Clear filters
          </Link>
        ) : null}
      </form>

      {transactions.length === 0 && page > 1 && totalCount > 0 ? (
        <EmptyState
          icon={<ListIcon className="h-10 w-10" />}
          heading="You've gone past the last page"
          message={`These filters only match ${totalCount} transaction${totalCount === 1 ? "" : "s"}.`}
          action={
            <Link
              href={buildHref(params, { page: "1" })}
              className="text-sm font-medium text-gold hover:text-gold-hover hover:underline"
            >
              Back to page 1
            </Link>
          }
        />
      ) : transactions.length === 0 ? (
        <EmptyState
          icon={<ListIcon className="h-10 w-10" />}
          heading={hasFilters ? "No transactions match" : "No transactions yet"}
          message={
            hasFilters
              ? "Try a wider date range or clear a filter to see more."
              : "Once you log transactions, they'll show up here, newest first."
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-hairline bg-surface">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Account</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {transactions.map((tx) => {
                  const signed = formatSignedAmount(
                    Number(tx.amount),
                    tx.transaction_type as TransactionType,
                  );
                  return (
                    <tr key={tx.id} className="motion-safe:animate-[row-in_600ms_ease-out]">
                      <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">
                        {formatDate(tx.transaction_date)}
                      </td>
                      <td className="px-4 py-3 text-ink">{tx.description}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2 text-ink-secondary">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{
                              backgroundColor: tx.category_color ?? "var(--color-ink-muted)",
                            }}
                            aria-hidden="true"
                          />
                          {tx.category_name ?? "Uncategorized"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">
                        {tx.account_name ?? "—"}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium tabular-nums ${toneClass[signed.tone]}`}
                      >
                        <span aria-hidden="true">{signed.arrow}</span> {signed.text}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-3">
                          <Link
                            href={`/transactions/${tx.id}/edit`}
                            className="text-sm font-medium text-ink-secondary hover:text-ink"
                          >
                            Edit
                          </Link>
                          <DeleteTransactionButton
                            id={tx.id}
                            description={tx.description}
                            amount={tx.amount}
                            transactionType={tx.transaction_type as TransactionType}
                            transactionDate={tx.transaction_date}
                            redirectToList={false}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-secondary">
            <p>
              Showing {(page - 1) * TRANSACTIONS_PAGE_SIZE + 1}–
              {Math.min(page * TRANSACTIONS_PAGE_SIZE, totalCount)} of {totalCount}
            </p>
            <div className="flex items-center gap-3">
              {page > 1 ? (
                <Link
                  href={buildHref(params, { page: String(page - 1) })}
                  className="font-medium text-ink-secondary hover:text-ink"
                >
                  Previous
                </Link>
              ) : (
                <span className="font-medium text-ink-muted opacity-50">Previous</span>
              )}
              <span className="text-ink-muted">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Link
                  href={buildHref(params, { page: String(page + 1) })}
                  className="font-medium text-ink-secondary hover:text-ink"
                >
                  Next
                </Link>
              ) : (
                <span className="font-medium text-ink-muted opacity-50">Next</span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
