import { Fragment } from "react";
import Link from "next/link";
import { listAccountBalances, listAccounts, getMostUsedAssetAccountId } from "@/lib/db/accounts";
import { getNetWorth } from "@/lib/db/dashboard";
import { listCategoriesForType } from "@/lib/db/categories";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { StatTile } from "@/components/ui/StatTile";
import { WalletIcon } from "@/components/ui/icons";
import { formatAccountBalance } from "@/lib/format";
import { todayISO } from "@/lib/date";
import { ACCOUNT_TYPE_GROUP_ORDER, isLiabilityAccountType } from "@/lib/accountOptions";
import { CreateAccountForm } from "./CreateAccountForm";
import { AccountRow } from "./AccountRow";
import type { Database } from "@/lib/database.types";
import type { TransactionAccountOption } from "../transactions/AddTransactionForm";

type AccountBalanceRow = Database["public"]["Views"]["v_account_balances"]["Row"] & {
  opening_date: string | null;
};

// Name, type, balance, actions -- identical on every row on this screen so
// values fall into a real column instead of drifting per row. The name
// track behaves like 1fr (grows to fill, shrinks to 0) but never grows past
// 28rem: min() inside minmax() caps it without giving up the flex.
// AccountRow's <li> and each group's <ul> pick this up via
// grid-cols-subgrid rather than restating it, so "auto"/"max-content"
// resolve against every row in the section at once -- across group
// boundaries, not just within one.
// px-4 lives here, not on each row/heading, at sm+: a subgridded row (see
// AccountRow) inherits column-line positions straight from this container,
// and giving the row its own padding too would inset its subgrid from
// those lines by a second, compounding amount. One inset, in one place.
export const ACCOUNT_ROW_GRID =
  "sm:grid sm:grid-cols-[minmax(0,min(28rem,1fr))_auto_max-content_max-content] sm:gap-x-4 sm:px-4";

function isNamedAccount<T extends AccountBalanceRow>(
  a: T,
): a is T & { account_id: string; account_name: string } {
  return a.account_id !== null && a.account_name !== null;
}

function buildHref(archived: boolean) {
  return archived ? "/accounts?archived=1" : "/accounts";
}

export default async function AccountsPage({ searchParams }: PageProps<"/accounts">) {
  const params = await searchParams;
  const showArchived = params.archived === "1";

  const [
    accountsResult,
    netWorthResult,
    mostUsedAssetResult,
    incomeCategoriesResult,
    expenseCategoriesResult,
    accountsTableResult,
  ] = await Promise.all([
    listAccountBalances(),
    getNetWorth(),
    // These four only feed the "Make a payment" shortcut's pre-fill and the
    // opening-date display -- a failure there shouldn't take down the whole
    // accounts page, so they're deliberately left out of the error check
    // below.
    getMostUsedAssetAccountId(),
    listCategoriesForType("Income"),
    listCategoriesForType("Expense"),
    listAccounts(),
  ]);

  if (accountsResult.error !== null || netWorthResult.error !== null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Accounts" description="Every place your money lives, in one list." />
        <ErrorMessage
          severity="critical"
          message={
            accountsResult.error ??
            netWorthResult.error ??
            "We couldn't load your accounts. Refresh the page to try again."
          }
        />
      </div>
    );
  }

  // v_account_balances deliberately doesn't carry opening_date (see the
  // migration comment) -- merged in here from the base table so the edit
  // form and the "Make a payment" shortcut both have it.
  const openingDateById = new Map(
    (accountsTableResult.data ?? []).map((a) => [a.id, a.opening_date]),
  );
  const allAccounts: AccountBalanceRow[] = accountsResult.data.map((a) => ({
    ...a,
    opening_date: (a.account_id && openingDateById.get(a.account_id)) ?? null,
  }));

  // A brand-new user has zero accounts, full stop -- nothing else on this
  // page (hero figure, archived toggle) means anything yet, so the whole
  // view narrows to one unmissable call to action instead of a normal list
  // with an empty middle.
  if (allAccounts.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Accounts" description="Every place your money lives, in one list." />
        <EmptyState
          icon={<WalletIcon className="h-10 w-10" />}
          heading="Add your first account"
          message="Checking, savings, a credit card, cash in your pocket -- add whatever you track and we'll start building your picture from there."
          action={<CreateAccountForm label="Add your first account" />}
        />
      </div>
    );
  }

  const visibleAccounts = showArchived
    ? allAccounts
    : allAccounts.filter((account) => account.is_active);

  // "Make a payment" reuses AddTransactionForm's Transfer mode -- it needs
  // the same account/category props that form always needs, not just the
  // one row it's launched from.
  const transactionAccounts: TransactionAccountOption[] = allAccounts
    .filter((a) => a.is_active)
    .filter(isNamedAccount)
    .map((a) => ({
      id: a.account_id,
      account_name: a.account_name,
      is_active: true,
      opening_date: a.opening_date ?? todayISO(),
      account_type: a.account_type ?? "",
    }));
  const defaultFromAccountId = mostUsedAssetResult.data ?? null;
  const incomeCategories = incomeCategoriesResult.data ?? [];
  const expenseCategories = expenseCategoriesResult.data ?? [];

  const typeGroups = ACCOUNT_TYPE_GROUP_ORDER.map((type) => {
    const accounts = visibleAccounts
      .filter((account) => account.account_type === type)
      .slice()
      .sort((a, b) => (a.account_name ?? "").localeCompare(b.account_name ?? ""));
    const subtotal = accounts.reduce((sum, account) => sum + (account.balance ?? 0), 0);
    return { type, accounts, subtotal };
  }).filter((group) => group.accounts.length > 0);

  const assetGroups = typeGroups.filter((group) => !isLiabilityAccountType(group.type));
  const liabilityGroups = typeGroups.filter((group) => isLiabilityAccountType(group.type));

  // isFirst suppresses the divider above the very first group in a section
  // -- every other group gets one so its heading doesn't fuse into the
  // previous group's last row.
  function renderGroup(group: (typeof typeGroups)[number], isFirst: boolean) {
    return (
      // A Fragment, not a div -- h3 and ul need to be direct children of
      // the section's grid below so they can span/subgrid its columns.
      // A wrapping div would itself become a single ungridded cell.
      <Fragment key={group.type}>
        <h3
          className={`px-4 py-2 text-sm font-semibold text-ink-secondary sm:col-span-4 sm:px-0 ${isFirst ? "" : "border-t border-hairline"}`}
        >
          {group.type} <span className="text-ink-muted">·</span>{" "}
          <span className="tabular-nums text-ink">
            {formatAccountBalance(group.subtotal, group.type)}
          </span>
        </h3>
        <ul className="divide-y divide-gridline sm:col-span-4 sm:grid sm:grid-cols-subgrid">
          {group.accounts.map((account) => (
            <AccountRow
              key={account.account_id}
              account={account}
              transactionAccounts={transactionAccounts}
              defaultFromAccountId={defaultFromAccountId}
              incomeCategories={incomeCategories}
              expenseCategories={expenseCategories}
            />
          ))}
        </ul>
      </Fragment>
    );
  }

  return (
    // 72rem cap, centred -- on a wide screen the extra width becomes page
    // margin instead of stretching the row grid's gap between columns.
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader title="Accounts" description="Every place your money lives, in one list." />

      <StatTile
        id="accounts-net-worth"
        label="Total across accounts"
        value={netWorthResult.data?.net_worth ?? 0}
        format="currency"
        size="hero"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <CreateAccountForm />

        <Link
          href={buildHref(!showArchived)}
          aria-pressed={showArchived}
          className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-all duration-150 ease-out hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page ${
            showArchived
              ? "border-action/40 bg-action/10 text-action"
              : "border-hairline bg-surface text-ink-secondary hover:text-ink"
          }`}
        >
          {showArchived ? "Showing archived" : "Show archived"}
        </Link>
      </div>

      {visibleAccounts.length === 0 ? (
        <EmptyState
          icon={<WalletIcon className="h-10 w-10" />}
          heading="Everything here is archived"
          message="Bring an old account back, or start fresh with a new one -- either way, you're a click from having something to track."
          action={
            <Link
              href={buildHref(true)}
              className="rounded text-sm font-medium text-action transition-colors duration-150 hover:text-action-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Show archived accounts
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {assetGroups.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                What you have
              </h2>
              <div
                className={`rounded-2xl border border-hairline bg-surface ${ACCOUNT_ROW_GRID}`}
              >
                {assetGroups.map((group, i) => renderGroup(group, i === 0))}
              </div>
            </section>
          ) : null}

          {assetGroups.length > 0 && liabilityGroups.length > 0 ? (
            <div className="border-t border-hairline" aria-hidden="true" />
          ) : null}

          {liabilityGroups.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                What you owe
              </h2>
              <div
                className={`rounded-2xl border border-hairline bg-surface ${ACCOUNT_ROW_GRID}`}
              >
                {liabilityGroups.map((group, i) => renderGroup(group, i === 0))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
