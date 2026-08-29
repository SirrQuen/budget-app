"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GoalMeter } from "@/components/ui/GoalMeter";
import { Celebration } from "@/components/ui/Celebration";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Database } from "@/lib/database.types";

type GoalProgressRow = Database["public"]["Views"]["v_goal_progress"]["Row"];

// GoalMeter brings its own behaviour from the goal-bar spec: a glow that
// scales with completion, a fill that animates up from the last-seen value,
// and a milestone pulse when a threshold is crossed. onMilestone is the
// reduced-motion-safe channel for that last one -- a short text banner that
// fires whether or not the visual pulse does.
export function GoalMeters({ goals }: { goals: GoalProgressRow[] }) {
  const [milestone, setMilestone] = useState<string | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timeout.current), []);

  function announce(message: string) {
    setMilestone(message);
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setMilestone(null), 1800);
  }

  return (
    <section className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
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
            <GoalMeter
              goalId={g.goal_id ?? ""}
              goalName={g.goal_name ?? "This goal"}
              value={g.pct_complete ?? 0}
              onMilestone={(m) => announce(m.message)}
            />
            <p className="mt-1.5 text-sm text-ink-secondary">
              {formatCurrency(g.contributed_amount ?? 0)} of {formatCurrency(g.target_amount ?? 0)}
              {g.target_date ? ` · target ${formatDate(g.target_date)}` : ""}
            </p>
          </li>
        ))}
      </ul>

      {milestone ? (
        <div className="mt-4">
          <Celebration show message={milestone} icon="✦" />
        </div>
      ) : null}
    </section>
  );
}
