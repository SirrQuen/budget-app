import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { LoadError } from "@/components/ui/LoadError";
import { listAccounts } from "@/lib/db/accounts";
import { getToday } from "@/lib/db/settings";
import { UUID } from "@/lib/transactionFilters";
import { ImportFlow } from "./ImportFlow";

// Import transactions from a CSV (docs/Import-CSV.md). Reached from an
// account's page (?account=<id>, that account preselected) or Settings >
// Import. The file is read in the browser; see ImportFlow.
export default async function ImportPage({ searchParams }: PageProps<"/import">) {
  const query = await searchParams;
  const requested = typeof query.account === "string" && UUID.test(query.account) ? query.account : null;

  const [accountsResult, today] = await Promise.all([listAccounts({ is_active: true }), getToday()]);

  // Where "Back" goes: the Transactions screen if that's where it started
  // (with its account filter, if it had one), else the account, else Settings.
  const back =
    query.from === "transactions"
      ? { href: requested ? `/transactions?accountid=${requested}` : "/transactions", label: "Back to Transactions" }
      : requested
        ? { href: `/accounts/${requested}`, label: "Back to the account" }
        : { href: "/settings", label: "Back to Settings" };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Import transactions"
        description="Bring in a CSV file from your bank instead of typing each transaction. You'll see exactly what it does to your balance before anything is saved."
        action={
          <Link
            href={back.href}
            className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {back.label}
          </Link>
        }
      />
      {accountsResult.error !== null ? (
        <LoadError message={accountsResult.error} />
      ) : accountsResult.data.length === 0 ? (
        <LoadError message="Add an account first. An import goes into one of your accounts." />
      ) : (
        <ImportFlow
          accounts={accountsResult.data.map((a) => ({ id: a.id, name: a.account_name, type: a.account_type }))}
          initialAccountId={requested && accountsResult.data.some((a) => a.id === requested) ? requested : null}
          today={today}
        />
      )}
    </div>
  );
}
