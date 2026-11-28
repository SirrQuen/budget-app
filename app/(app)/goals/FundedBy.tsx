"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { callAction } from "@/components/useActionForm";
import { countEarlierOccurrencesAction, unlinkScheduleAction } from "@/lib/actions/goals";
import { AmountBasisTag } from "@/components/AmountBasisTag";
import { SameMoneyQuestion } from "@/components/SameMoneyQuestion";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { formatCurrency } from "@/lib/format";
import { formatSchedule } from "@/lib/recurringSchedule";
import { uncountedOffer } from "@/lib/goalSchedules";
import type { FeedingSchedule } from "@/lib/db/goals";
import type { GoalCompletion } from "@/lib/goalCompletion";
import type { SameMoneyPair } from "@/lib/goalLinks";

const TEXT_BUTTON =
  "-mx-2 inline-flex min-h-11 shrink-0 items-center rounded px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50 sm:mx-0 sm:px-0";

// "Funded by" (docs/Goals-and-Import.md Part A, rulings 1 and 4): the
// recurring transfers that feed this goal, each with its own amount and
// cadence -- never a monthly figure made from a frequency. The total line
// is what the projection itself subtracts this month for them
// (GoalScheduled), the same set the goal's hold is netted by. Ended and
// paused schedules aren't listed; what they already moved stays in the
// goal's history.
export function FundedBy({
  goalName,
  schedules,
  scheduledThisMonth,
  uncounted,
  onCompleted,
}: {
  goalName: string;
  schedules: FeedingSchedule[];
  /** This month's occurrences safe to spend subtracts for them, dollars; null when it couldn't be read. */
  scheduledThisMonth: number | null;
  /** Per schedule id, its confirmed transfers that don't count toward the goal yet. */
  uncounted: ReadonlyMap<string, number>;
  onCompleted: (completion: GoalCompletion) => void;
}) {
  if (schedules.length === 0) return null;
  return (
    <section aria-label={`Recurring transfers that fund ${goalName}`} className="flex flex-col gap-2 text-sm">
      <h3 className="text-xs font-medium text-ink-muted">Funded by</h3>
      <ul className="flex flex-col gap-2">
        {schedules.map((s) => (
          <FundedByRow
            key={s.id}
            schedule={s}
            uncounted={uncounted.get(s.id) ?? 0}
            onCompleted={onCompleted}
          />
        ))}
      </ul>
      {scheduledThisMonth !== null && scheduledThisMonth > 0 ? (
        <p className="text-ink-secondary">Scheduled this month: {formatCurrency(scheduledThisMonth)}</p>
      ) : null}
    </section>
  );
}

function FundedByRow({
  schedule,
  uncounted,
  onCompleted,
}: {
  schedule: FeedingSchedule;
  uncounted: number;
  onCompleted: (completion: GoalCompletion) => void;
}) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [counted, setCounted] = useState(false);
  const [questions, setQuestions] = useState<SameMoneyPair[]>([]);

  function unlink() {
    setError(undefined);
    start(async () => {
      const result = await callAction(() => unlinkScheduleAction(schedule.id));
      if (result?.error) setError(result.error);
    });
  }

  function countThem() {
    setError(undefined);
    start(async () => {
      const result = await callAction(() => countEarlierOccurrencesAction(schedule.id));
      if (result?.error) {
        setError(result.error);
        return;
      }
      setCounted(true);
      if (result && "sameMoney" in result) setQuestions(result.sameMoney ?? []);
      if (result && "completed" in result && result.completed) onCompleted(result.completed);
    });
  }

  return (
    <li className="flex flex-col gap-1 rounded-xl border border-hairline px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <Link
            href={`/recurring#schedule-${schedule.id}`}
            className="rounded font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            {schedule.description}
          </Link>
          <p className="text-ink-secondary">
            {formatCurrency(schedule.amount)} <AmountBasisTag basis={schedule.basis} /> ·{" "}
            {formatSchedule(schedule.frequency, schedule.anchorDate, schedule.intervalCount)} to {schedule.toAccountName}
          </p>
        </div>
        <button
          type="button"
          onClick={unlink}
          disabled={pending}
          className={TEXT_BUTTON}
          aria-label={`Unlink ${schedule.description} from this goal`}
        >
          Unlink
        </button>
      </div>
      {uncounted > 0 && !counted ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-secondary">
          <span>{uncountedOffer(uncounted, schedule.description)}</span>
          <button type="button" onClick={countThem} disabled={pending} className={TEXT_BUTTON}>
            {pending ? "Counting…" : uncounted === 1 ? "Count it" : "Count them"}
          </button>
        </div>
      ) : null}
      {questions.length > 0 ? (
        <SameMoneyQuestion pair={questions[0]} onDone={() => setQuestions((q) => q.slice(1))} />
      ) : null}
      {error ? <ErrorMessage message={error} /> : null}
    </li>
  );
}
