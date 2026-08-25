import Link from "next/link";
import {
  listTransactions,
  TRANSACTIONS_PAGE_SIZE,
  type TransactionType,
} from "@/lib/db/transactions";
import { listCategories, listCategoriesForType } from "@/lib/db/categories";
import { listAccounts } from "@/lib/db/accounts";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { AddTransactionForm } from "./AddTransactionForm";
import { TransactionsList } from "./TransactionsList";

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

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
            className="rounded text-sm font-medium text-gold transition-colors duration-150 hover:text-gold-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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
          className="inline-flex items-center justify-center rounded-full bg-gold px-4 py-2 text-sm font-semibold text-gold-ink transition-all duration-150 ease-out hover:-translate-y-0.5 hover:bg-gold-hover hover:shadow-md active:translate-y-0 active:scale-[0.97] active:bg-gold-pressed active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Filter
        </button>

        {hasFilters ? (
          <Link
            href="/transactions"
            className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Clear filters
          </Link>
        ) : null}
      </form>

      <TransactionsList
        transactions={transactions}
        totalCount={totalCount}
        page={page}
        totalPages={totalPages}
        pageSize={TRANSACTIONS_PAGE_SIZE}
        params={params}
        hasFilters={hasFilters}
      />
    </div>
  );
}
