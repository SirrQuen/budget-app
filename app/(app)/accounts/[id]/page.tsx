import Link from "next/link";
import { notFound } from "next/navigation";
import { getAccount, getAccountBalance, getAccountLastLogged } from "@/lib/db/accounts";
import { getToday } from "@/lib/db/settings";
import { PageHeader } from "@/components/ui/PageHeader";
import { LoadError } from "@/components/ui/LoadError";
import { StatTile } from "@/components/ui/StatTile";
import { formatDate } from "@/lib/format";
import { isLiabilityAccountType } from "@/lib/accountOptions";
import { lastLoggedLabel } from "@/lib/lastLogged";
import { UUID } from "@/lib/transactionFilters";
import { TransactionsView } from "../../transactions/TransactionsView";

// An account's page: its balance on top, then the one transaction list with
// this account fixed (TransactionsView). The balance is read from
// v_account_balances -- never a sum of the rows below, which may be filtered
// or paged.
export default async function AccountPage({ params, searchParams }: PageProps<"/accounts/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const query = await searchParams;

  const [balanceResult, accountResult, lastLoggedResult, today] = await Promise.all([
    getAccountBalance(id),
    getAccount(id),
    getAccountLastLogged(),
    getToday(),
  ]);

  // No row means no such account for this person (RLS) -- the same page as
  // any other missing one.
  if (balanceResult.error === null && balanceResult.data === null) notFound();

  if (balanceResult.error !== null || accountResult.error !== null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Account" />
        <LoadError
          message={
            balanceResult.error ??
            accountResult.error ??
            "We couldn't load this account. Refresh the page to try again."
          }
        />
      </div>
    );
  }

  const balance = balanceResult.data!;
  const account = accountResult.data;
  const name = balance.account_name ?? account.account_name;
  const type = balance.account_type ?? account.account_type;
  const owed = isLiabilityAccountType(type);
  // A failed last-logged read loses only that line.
  const lastLogged = lastLoggedResult.error === null ? lastLoggedLabel(lastLoggedResult.data.get(id) ?? null, today) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={name}
        description={[type, account.institution, account.is_active ? null : "Archived"].filter(Boolean).join(" · ")}
        action={
          <Link
            href="/accounts"
            className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            All accounts
          </Link>
        }
      />

      <div className="flex flex-col gap-2">
        {/* Liability balances are stored negative; shown as the amount owed. */}
        <StatTile
          id={`account-balance-${id}`}
          label={owed ? "Owed" : "Balance"}
          value={owed ? Math.abs(balance.balance ?? 0) : (balance.balance ?? 0)}
          format="currency"
          size="hero"
        />
        <p className="text-sm text-ink-secondary">
          Balance set as of {formatDate(account.opening_date)}
          {lastLogged ? ` · ${lastLogged}` : ""}
        </p>
      </div>

      <TransactionsView searchParams={query} basePath={`/accounts/${id}`} lockedAccountId={id} />
    </div>
  );
}
