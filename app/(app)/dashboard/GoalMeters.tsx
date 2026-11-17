"use client";

import Link from "next/link";
import { GoalStem } from "@/components/ui/GoalStem";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Database } from "@/lib/database.types";

type GoalProgressRow = Database["public"]["Views"]["v_goal_progress"]["Row"];

export function GoalMeters({ goals }: { goals: GoalProgressRow[] }) {
  return (
    <section className="h-full rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-ink-secondary">Goals</h2>
        <Link
          href="/goals"
          className="text-xs text-ink-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          All goals
        </Link>
      </div>

      <ul className="flex flex-col gap-4">
        {goals.map((g) => (
          <li key={g.goal_id}>
            <GoalStem
              goalName={g.goal_name ?? "This goal"}
              value={g.pct_complete ?? 0}
              toGo={g.remaining_amount ?? null}
              complete={g.is_paid_off === true || g.completed_at != null}
            />
            <p className="mt-1.5 text-sm text-ink-secondary">
              {/* A goal that follows a card (migration 70) reads by what it still owes. */}
              {g.tracking_method === "LinkedAccount"
                ? g.is_paid_off
                  ? "Paid off"
                  : `${formatCurrency(g.remaining_amount ?? 0)} to go · follows ${g.linked_account_name ?? "the card"}`
                : `${formatCurrency(g.contributed_amount ?? 0)} of ${formatCurrency(g.target_amount ?? 0)}`}
              {g.target_date ? ` · target ${formatDate(g.target_date)}` : ""}
            </p>
          </li>
        ))}
      </ul>

    </section>
  );
}
