import Link from "next/link";
import { Meter } from "@/components/ui/Meter";
import { formatCurrency } from "@/lib/format";
import type { BudgetProgressRow } from "@/lib/db/budgets";

// The top few budgets for this month. Meter carries the reading: percentage
// in the header, a fill that shifts good -> warning gradually (never a red
// snap), and a bar that runs past the target marker rather than capping
// once spend clears the envelope. The line beneath states position -- what's
// spent, what's left -- never a verdict.
export function BudgetMeters({ budgets }: { budgets: BudgetProgressRow[] }) {
  return (
    <section className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-ink-secondary">Budgets</h2>
        <Link
          href="/budgets"
          className="text-xs text-ink-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          All budgets
        </Link>
      </div>

      <ul className="flex flex-col gap-4">
        {budgets.map((b) => {
          const spent = b.actual_spend ?? 0;
          const budgeted = b.budget_amount ?? 0;
          const remaining = b.remaining ?? 0;
          const over = (b.is_over_budget ?? false) || remaining < 0;
          return (
            <li key={b.budget_id}>
              <Meter value={b.pct_used ?? 0} label={b.category_name ?? "Category"} />
              <p className="mt-1.5 text-sm text-ink-secondary">
                {formatCurrency(spent)} of {formatCurrency(budgeted)} ·{" "}
                {over
                  ? `${formatCurrency(Math.abs(remaining))} over this month`
                  : `${formatCurrency(remaining)} left this month`}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
