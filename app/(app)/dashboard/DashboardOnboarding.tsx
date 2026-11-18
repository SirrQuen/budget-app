import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionError } from "./SectionError";
import { AccountLink } from "@/components/AccountLink";
import { SorrelMark } from "@/components/SorrelMark";
import { PlusIcon } from "@/components/ui/icons";
import { formatAccountBalance, formatCompactNumber } from "@/lib/format";
import type { Database } from "@/lib/database.types";
import type { SafeToSpend } from "@/lib/db/dashboard";
import { SafeToSpendHero } from "./SafeToSpendHero";

type AccountBalanceRow = Database["public"]["Views"]["v_account_balances"]["Row"];

// A filled primary action, as a link -- the same treatment Button gives a
// <button>, for the one CTA these screens are built around.
const primaryAction =
  "inline-flex items-center justify-center gap-1.5 rounded-full bg-action px-4 py-2 text-sm font-semibold text-action-ink transition-all duration-150 ease-out hover:-translate-y-0.5 hover:bg-action-hover hover:shadow-md active:translate-y-0 active:scale-[0.97] active:bg-action-pressed active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page";

// The open trefoil as texture above the ladder's copy -- at 8% it sits in
// the surface rather than competing with the heading. EmptyState already
// hides its icon slot from assistive tech, so the mark's own label is moot.
const ladderMark = <SorrelMark size={104} className="opacity-[0.08]" />;

// `welcome` is the resolved greeting from welcomeMessage() in
// lib/displayName.ts -- built once in the page, shared by every stage.
//
// Stage 1 (no accounts) is onboarding now: OnboardingFlow.tsx.

// Stage 2: accounts, but nothing logged yet. The balances are real, so show
// them. Everything time-based is a promise, not a figure.
export function NoTransactionsView({
  welcome,
  accounts,
  accountsError,
  netWorth,
  netWorthError,
  safeToSpend,
  billsCard = null,
}: {
  welcome: string;
  accounts: AccountBalanceRow[];
  accountsError: string | null;
  netWorth: number | null;
  netWorthError: string | null;
  /** The figure onboarding's step 3 showed: the hero, from its own read. null when it didn't load. */
  safeToSpend: SafeToSpend | null;
  /** The bills card (BillsCard), when it shows. */
  billsCard?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description={welcome} />

      {/* The number onboarding ended on, here to stay. A failed read leaves
          it out: the full dashboard's section errors aren't on this view. */}
      {safeToSpend ? <SafeToSpendHero data={safeToSpend} /> : null}
      {billsCard}

      {/* A failed read says so; it never just drops the figure. With the
          accounts list down too, that notice covers both. */}
      {netWorthError && !accountsError ? (
        <SectionError label="Total across accounts" />
      ) : !accountsError && netWorth !== null ? (
        <div className="rounded-2xl border border-hairline bg-surface p-4">
          <p className="text-sm font-medium text-ink-secondary">Total across accounts</p>
          <p className="mt-1 text-5xl font-semibold text-ink">
            {formatCompactNumber(netWorth, { currency: true })}
          </p>
        </div>
      ) : null}

      {/* Above the account list, not after it: logging is the one thing
          this stage asks for, and below a list its CTA falls off a 375px
          screen once there's more than an account or two. */}
      <EmptyState
        icon={ladderMark}
        heading="Log your first transaction"
        message="Your cash flow, budgets and spending trends all build from what you log. Add a few transactions and this dashboard fills in."
        action={
          <Link href="/transactions" className={primaryAction}>
            <PlusIcon className="h-4 w-4" aria-hidden="true" />
            Log your first transaction
          </Link>
        }
      />

      {accountsError ? (
        <SectionError label="Your accounts" />
      ) : (
        <section className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-medium text-ink-secondary">Your accounts</h2>
          <ul className="divide-y divide-hairline">
            {accounts.map((a) => (
              <li
                key={a.account_id}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                {a.account_id ? <AccountLink accountId={a.account_id}>{a.account_name}</AccountLink> : <span className="min-w-0 truncate text-ink">{a.account_name}</span>}
                <span className="shrink-0 font-medium tabular-nums text-ink">
                  {formatAccountBalance(a.balance ?? 0, a.account_type ?? "")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
