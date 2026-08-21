import Link from "next/link";
import { listAccountBalances } from "@/lib/db/accounts";
import { getNetWorth } from "@/lib/db/dashboard";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { StatTile } from "@/components/ui/StatTile";
import { WalletIcon } from "@/components/ui/icons";
import { CreateAccountForm } from "./CreateAccountForm";
import { AccountRow } from "./AccountRow";

function buildHref(archived: boolean) {
  return archived ? "/accounts?archived=1" : "/accounts";
}

export default async function AccountsPage({ searchParams }: PageProps<"/accounts">) {
  const params = await searchParams;
  const showArchived = params.archived === "1";

  const [accountsResult, netWorthResult] = await Promise.all([
    listAccountBalances(),
    getNetWorth(),
  ]);

  if (accountsResult.error !== null || netWorthResult.error !== null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Accounts" description="Every place your money lives, in one list." />
        <ErrorMessage
          message={accountsResult.error ?? netWorthResult.error ?? "Failed to load accounts."}
        />
      </div>
    );
  }

  const allAccounts = accountsResult.data;

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Accounts" description="Every place your money lives, in one list." />

      <StatTile
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
          className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
            showArchived
              ? "border-gold/40 bg-gold/10 text-gold"
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
              className="text-sm font-medium text-gold hover:text-gold-hover hover:underline"
            >
              Show archived accounts
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-hairline rounded-2xl border border-hairline bg-surface">
          {visibleAccounts.map((account) => (
            <AccountRow key={account.account_id} account={account} />
          ))}
        </ul>
      )}
    </div>
  );
}
