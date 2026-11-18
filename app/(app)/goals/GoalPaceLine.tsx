"use client";

import { useToday } from "@/components/TodayProvider";
import { BloomCalendar } from "@/components/ui/BloomCalendar";
import { goalPaceLine, type GoalPace } from "@/lib/goalPace";

// The goal card's pace line (docs/Decide-and-Grow.md, section H): the
// history pace from goal_pace() and nothing else -- the view's
// monthly_contribution projection is never shown. Hidden entirely when
// there's no pace to state.
export function GoalPaceLine({ pace, name }: { pace: GoalPace; name: string }) {
  const today = useToday();
  const line = goalPaceLine(pace, name, today);
  if (line === null) return null;

  return (
    <div className="flex items-start gap-3 text-sm">
      {line.month ? <BloomCalendar goalId={pace.goalId} month={line.month} /> : null}
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className={line.month ? "text-ink" : "text-ink-secondary"}>{line.headline}</p>
        {line.target ? <p className="text-ink-secondary">{line.target}</p> : null}
        {line.basis ? <p className="text-xs text-ink-muted">{line.basis}</p> : null}
      </div>
    </div>
  );
}
