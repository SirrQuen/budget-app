import Link from "next/link";
import { getBudgetProgress } from "@/lib/db/budgets";
import { listCategoriesForType } from "@/lib/db/categories";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { PieIcon } from "@/components/ui/icons";
import { CreateBudgetForm } from "./CreateBudgetForm";
import { BudgetRow } from "./BudgetRow";

const MONTH_RE = /^\d{4}-\d{2}-01$/;

function currentMonthISO(): string {
  // Local calendar month, not UTC -- see AddTransactionForm's todayISO for
  // why the offset adjustment matters near midnight.
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return `${local.toISOString().slice(0, 7)}-01`;
}

function shiftMonth(monthISO: string, delta: number): string {
  const [y, m] = monthISO.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function formatMonthLabel(monthISO: string): string {
  const [y, m] = monthISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function BudgetsPage({ searchParams }: PageProps<"/budgets">) {
  const params = await searchParams;
  const month =
    typeof params.month === "string" && MONTH_RE.test(params.month)
      ? params.month
      : currentMonthISO();

  const [progressResult, categoriesResult] = await Promise.all([
    getBudgetProgress({ budget_month: month }),
    listCategoriesForType("Expense"),
  ]);

  if (progressResult.error !== null || categoriesResult.error !== null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Budgets"
          description="Set a monthly envelope for each category and watch it fill."
        />
        <ErrorMessage
          message={progressResult.error ?? categoriesResult.error ?? "Failed to load budgets."}
        />
      </div>
    );
  }

  // v_budget_vs_actual also reports categories with spend but no budget
  // (status "Unbudgeted", budget_id null) -- this page only manages actual
  // budgets, so those rows are filtered out.
  const budgets = progressResult.data.filter((row) => row.budget_id !== null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Budgets"
        description="Set a monthly envelope for each category and watch it fill."
      />

      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/budgets?month=${shiftMonth(month, -1)}`}
          className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-sm font-medium text-ink-secondary hover:text-ink"
        >
          ← Prev
        </Link>
        <span className="text-sm font-medium text-ink">{formatMonthLabel(month)}</span>
        <Link
          href={`/budgets?month=${shiftMonth(month, 1)}`}
          className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-sm font-medium text-ink-secondary hover:text-ink"
        >
          Next →
        </Link>
      </div>

      <CreateBudgetForm categories={categoriesResult.data} month={month} />

      {budgets.length === 0 ? (
        <EmptyState
          icon={<PieIcon className="h-10 w-10" />}
          heading={`Nothing budgeted for ${formatMonthLabel(month)}`}
          message="Pick a category above and give it a number -- that's the whole system. The meter fills in as you spend."
        />
      ) : (
        <ul className="divide-y divide-hairline rounded-2xl border border-hairline bg-surface">
          {budgets.map((budget) => (
            <BudgetRow key={budget.budget_id} budget={budget} categories={categoriesResult.data} />
          ))}
        </ul>
      )}
    </div>
  );
}
