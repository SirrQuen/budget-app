import Link from "next/link";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { TransferIcon, InfoIcon } from "@/components/ui/icons";
import { formatCurrency, formatDateShort } from "@/lib/format";
import type { Database } from "@/lib/database.types";
import { ConfirmVariableAmountSheet } from "../recurring/ConfirmVariableAmountSheet";

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
          <li key={r.recurring_id} className="flex flex-col gap-1 py-2.5 text-sm">
            <div className="flex items-center gap-3">
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
            </div>

            {/* is_estimated_amount: a variable schedule with no confirmed
                next_amount yet -- the figure above is a live guess off the
                card's balance, never presented as a known one (CLAUDE.md
                "Display"). */}
            {r.is_estimated_amount ? (
              <div className="flex items-center justify-between gap-2 pl-7 text-xs text-ink-muted">
                <span className="inline-flex items-center gap-1">
                  <InfoIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {r.is_overdue ? "Needs your amount" : "Estimate"}
                </span>
                <ConfirmVariableAmountSheet
                  target={{
                    id: r.recurring_id ?? "",
                    cardName: r.to_account_name ?? "the card",
                    estimatedAmount: r.amount ?? 0,
                    statementDay: r.statement_day ?? 1,
                    dueDate: r.next_run_date ?? "",
                  }}
                  trigger={(open) => (
                    <button
                      type="button"
                      onClick={open}
                      className="font-medium text-action transition-colors duration-150 hover:text-action-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                    >
                      Confirm
                    </button>
                  )}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
