import Link from "next/link";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { TransferIcon } from "@/components/ui/icons";
import { formatCurrency, formatDateShort } from "@/lib/format";
import type { Database } from "@/lib/database.types";

type UpcomingRow = Database["public"]["Views"]["v_upcoming_recurring"]["Row"];

// A handful of dated items is a list, not a chart. Each row: what it is, when
// it's due, how much. v_upcoming_recurring carries no Income/Expense
// direction, so the amount shows unsigned.
export function UpcomingList({ items }: { items: UpcomingRow[] }) {
  return (
    <section className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-ink-secondary">Upcoming</h2>
        <Link
          href="/transactions"
          className="text-xs text-ink-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Transactions
        </Link>
      </div>

      <ul className="divide-y divide-hairline">
        {items.map((r) => (
          <li key={r.recurring_id} className="flex items-center gap-3 py-2.5 text-sm">
            {r.to_accountid !== null ? (
              <TransferIcon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            ) : (
              <CategoryIcon icon={r.category_icon} className="h-4 w-4 shrink-0 text-ink-muted" />
            )}
            <span className="min-w-0 flex-1 truncate text-ink">{r.description}</span>
            <span className="shrink-0 tabular-nums text-ink-secondary">
              {r.next_run_date ? formatDateShort(r.next_run_date) : "—"}
            </span>
            <span className="shrink-0 tabular-nums font-medium text-ink">
              {formatCurrency(r.amount ?? 0)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
