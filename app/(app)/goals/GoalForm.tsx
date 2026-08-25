"use client";

import { useEffect, useRef } from "react";
import { useActionState } from "react";
import { createGoalAction, type ActionState } from "@/lib/actions/goals";
import { GOAL_TYPES } from "@/lib/goalOptions";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

const fieldClassName =
  "w-full rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-gold focus:ring-2 focus:ring-gold/40";

// Create-only -- there's no edit flow yet, unlike CategoryForm/AccountForm's
// shared create+edit pattern. A goal set up wrong today can be deleted (via
// GoalRow, once that exists) and re-created; editing is a natural follow-up,
// not something this pass needs.
export function GoalForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createGoalAction, undefined);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) {
      onSuccess();
    }
    wasPending.current = pending;
  }, [pending, state, onSuccess]);

  return (
    <form
      action={action}
      className="flex flex-col gap-5 rounded-2xl border border-hairline bg-surface p-5"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">New goal</h2>
        <button
          type="button"
          onClick={onCancel}
          className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Cancel
        </button>
      </div>

      <FormField label="Name" htmlFor="goal_name" required>
        <Input id="goal_name" name="goal_name" required maxLength={60} placeholder="e.g. Japan trip" />
      </FormField>

      <FormField label="Type" htmlFor="goal_type" required>
        <select id="goal_type" name="goal_type" required defaultValue="" className={fieldClassName}>
          <option value="" disabled>
            Select a type
          </option>
          {GOAL_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Target amount" htmlFor="target_amount" required>
          <Input
            id="target_amount"
            name="target_amount"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            required
          />
        </FormField>

        <FormField label="Target date" htmlFor="target_date" hint="Optional">
          <input id="target_date" name="target_date" type="date" className={fieldClassName} />
        </FormField>
      </div>

      <FormField
        label="Monthly contribution"
        htmlFor="monthly_contribution"
        hint="Optional -- what you're aiming to put toward it each month."
      >
        <Input
          id="monthly_contribution"
          name="monthly_contribution"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          placeholder="0.00"
        />
      </FormField>

      {state?.error ? <ErrorMessage message={state.error} /> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Add goal"}
      </Button>
    </form>
  );
}
