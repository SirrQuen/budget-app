"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { contributeToGoalAction, type ContributeActionState } from "@/lib/actions/goals";
import { Meter } from "@/components/ui/Meter";
import { Celebration } from "@/components/ui/Celebration";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { TargetIcon } from "@/components/ui/icons";
import { formatCurrency } from "@/lib/format";
import type { Database } from "@/lib/database.types";

type GoalProgressRow = Database["public"]["Views"]["v_goal_progress"]["Row"];

const fieldClassName =
  "w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-gold focus:ring-2 focus:ring-gold/40";

function todayISO() {
  // Local calendar day, not UTC -- see AddTransactionForm's todayISO.
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function GoalRow({ goal }: { goal: GoalProgressRow }) {
  const [contributing, setContributing] = useState(false);
  const [state, action, pending] = useActionState<ContributeActionState, FormData>(
    contributeToGoalAction,
    undefined,
  );
  const [celebrate, setCelebrate] = useState(false);
  const [celebrateMessage, setCelebrateMessage] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);
  const celebrateTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const succeeded = wasPending.current && !pending && !state?.error;
    const milestone = state?.milestone;
    wasPending.current = pending;

    if (succeeded) {
      formRef.current?.reset();
      setContributing(false);
    }
    if (succeeded && milestone) {
      setCelebrateMessage(milestone.message);
      setCelebrate(true);
      clearTimeout(celebrateTimeout.current);
      celebrateTimeout.current = setTimeout(() => setCelebrate(false), 1800);
    }
  }, [pending, state]);

  useEffect(() => () => clearTimeout(celebrateTimeout.current), []);

  const target = goal.target_amount ?? 0;
  const contributed = goal.contributed_amount ?? 0;
  const remaining = goal.remaining_amount ?? 0;
  const pct = goal.pct_complete ?? 0;

  return (
    <li className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-center gap-3">
        <TargetIcon className="h-4 w-4 shrink-0 text-ink-secondary" aria-hidden="true" />
        <span className="flex-1 text-sm font-medium text-ink">{goal.goal_name}</span>
        <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-xs font-medium text-ink-muted">
          {goal.goal_type}
        </span>
        <button
          type="button"
          onClick={() => setContributing((v) => !v)}
          className="shrink-0 text-sm font-medium text-ink-secondary hover:text-ink"
        >
          {contributing ? "Cancel" : "Add contribution"}
        </button>
      </div>

      {/* Goal progress has no bad zone -- unlike a budget meter, more filled
          is never worse, so the warning/critical thresholds are pushed past
          100 to keep this a single accent hue throughout. */}
      <Meter value={pct} max={100} warningAt={101} criticalAt={101} label={goal.goal_name ?? undefined} />

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-ink-secondary">
          {formatCurrency(contributed)} of {formatCurrency(target)} saved
        </span>
        <span className="text-ink-secondary">
          {remaining > 0 ? `${formatCurrency(remaining)} to go` : "Goal reached"}
        </span>
      </div>

      {contributing ? (
        <form
          ref={formRef}
          action={action}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-hairline bg-surface-raised p-3"
        >
          <input type="hidden" name="goalid" value={goal.goal_id ?? ""} />
          <FormField label="Date" htmlFor={`date-${goal.goal_id}`}>
            <input
              id={`date-${goal.goal_id}`}
              name="date"
              type="date"
              required
              defaultValue={todayISO()}
              className={fieldClassName}
            />
          </FormField>
          <FormField label="Amount" htmlFor={`amount-${goal.goal_id}`}>
            <Input
              id={`amount-${goal.goal_id}`}
              name="amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              required
            />
          </FormField>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Log contribution"}
          </Button>
          {state?.error ? <ErrorMessage message={state.error} /> : null}
        </form>
      ) : null}

      <Celebration show={celebrate} message={celebrateMessage} icon="✦" />
    </li>
  );
}
