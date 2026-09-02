import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionError } from "./SectionError";
import { WalletIcon, ListIcon, PlusIcon } from "@/components/ui/icons";
import { formatAccountBalance, formatCompactNumber } from "@/lib/format";
import type { Database } from "@/lib/database.types";

type AccountBalanceRow = Database["public"]["Views"]["v_account_balances"]["Row"];

// A filled primary action, as a link -- the same treatment Button gives a
// <button>, for the one CTA these screens are built around.
const primaryAction =
  "inline-flex items-center justify-center gap-1.5 rounded-full bg-action px-4 py-2 text-sm font-semibold text-action-ink transition-all duration-150 ease-out hover:-translate-y-0.5 hover:bg-action-hover hover:shadow-md active:translate-y-0 active:scale-[0.97] active:bg-action-pressed active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page";

function greeting(firstName: string | undefined, isFirstLogin: boolean): string {
  const name = firstName ? `, ${firstName}` : "";
  return isFirstLogin ? `Welcome to EverNest${name}.` : `Welcome back${name}.`;
}

// Stage 1: no accounts. Nothing else on the dashboard means anything until
// there's an account to log against, so the whole view is one welcome and
// one action -- no $0 hero, no empty charts, no zeroed tiles.
export function NoAccountsView({ firstName }: { firstName?: string }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description={firstName ? `Welcome to EverNest, ${firstName}.` : "Welcome to EverNest."}
      />
      <EmptyState
        icon={<WalletIcon className="h-10 w-10" />}
        heading="Add your first account"
        message="EverNest keeps your accounts, spending, budgets and goals in one place. It starts with an account — checking, savings, a card, or the cash in your pocket."
        action={
          <Link href="/accounts" className={primaryAction}>
            <PlusIcon className="h-4 w-4" aria-hidden="true" />
            Add your first account
          </Link>
        }
      />
    </div>
  );
}

// Stage 2: accounts, but nothing logged yet. The balances are real, so show
// them. Everything time-based is a promise, not a figure.
export function NoTransactionsView({
  firstName,
  isFirstLogin,
  accounts,
  accountsError,
  netWorth,
}: {
  firstName?: string;
  isFirstLogin: boolean;
  accounts: AccountBalanceRow[];
  accountsError: string | null;
  netWorth: number | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description={greeting(firstName, isFirstLogin)} />

      {accountsError ? (
        <SectionError label="Your accounts" />
      ) : (
        <>
          {netWorth !== null ? (
            <div className="rounded-2xl border border-hairline bg-surface p-4">
              <p className="text-sm font-medium text-ink-secondary">Total across accounts</p>
              <p className="mt-1 text-5xl font-semibold text-ink">
                {formatCompactNumber(netWorth, { currency: true })}
              </p>
            </div>
          ) : null}

          <section className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-medium text-ink-secondary">Your accounts</h2>
            <ul className="divide-y divide-hairline">
              {accounts.map((a) => (
                <li
                  key={a.account_id}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm"
                >
                  <span className="min-w-0 truncate text-ink">{a.account_name}</span>
                  <span className="shrink-0 font-medium tabular-nums text-ink">
                    {formatAccountBalance(a.balance ?? 0, a.account_type ?? "")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <EmptyState
        icon={<ListIcon className="h-10 w-10" />}
        heading="Log your first transaction"
        message="Your cash flow, budgets, streak and spending trends all build from what you log. Add a few transactions and this dashboard fills in."
        action={
          <Link href="/transactions" className={primaryAction}>
            <PlusIcon className="h-4 w-4" aria-hidden="true" />
            Log your first transaction
          </Link>
        }
      />
    </div>
  );
}
