import Link from "next/link";
import { lastLoggedLabel } from "@/lib/lastLogged";

// One line per account: when something was last logged there (created_at,
// migration 64). A balance nobody has logged to in weeks is probably stale
// -- the same gap the pre-anchor question closes -- and this is how someone
// notices before the number misleads them. Stated as a fact in neutral ink:
// no warning state, no colour, no threshold where it changes.
export function AccountActivity({
  accounts,
  lastLogged,
  today,
}: {
  accounts: { account_id: string | null; account_name: string | null }[];
  lastLogged: Map<string, string>;
  today: string;
}) {
  const rows = accounts.filter((a): a is { account_id: string; account_name: string | null } => a.account_id !== null);
  if (rows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-ink-secondary">Accounts</h2>
        <Link
          href="/accounts"
          className="text-xs text-ink-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          All accounts
        </Link>
      </div>
      <ul className="divide-y divide-hairline">
        {rows.map((a) => (
          <li key={a.account_id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
            <Link
              href={`/accounts/${a.account_id}`}
              className="min-w-0 truncate rounded underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface text-ink"
            >
              {a.account_name ?? "Account"}
            </Link>
            <span className="shrink-0 text-ink-secondary">
              {lastLoggedLabel(lastLogged.get(a.account_id) ?? null, today)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
