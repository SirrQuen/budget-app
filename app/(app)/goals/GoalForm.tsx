"use client";

import { useEffect, useRef } from "react";
import { useActionForm } from "@/components/useActionForm";
import { createGoalAction, updateGoalAction, type ActionState } from "@/lib/actions/goals";
import type { GoalCompletion } from "@/lib/goalCompletion";
import { GOAL_TYPES } from "@/lib/goalOptions";
import { FormField, useFieldId } from "@/components/ui/FormField";
import { Input, FIELD_CLASS } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

const fieldClassName = FIELD_CLASS;

/** The fields an edit pre-fills -- a v_goal_progress row carries all of them. */
export type EditableGoal = {
  goal_id: string;
  goal_name: string;
  goal_type: string;
  target_amount: number;
  target_date: string | null;
  monthly_contribution: number | null;
};

// Create and edit share one form, like CategoryForm/AccountForm, so the two
// can't accept different fields. With `goal` it edits that goal.
export function GoalForm({
  goal,
  onSuccess,
  onCancel,
  onCompleted,
}: {
  goal?: EditableGoal;
  onSuccess: () => void;
  onCancel: () => void;
  /** The save completed the goal (a lowered target): show the panel. */
  onCompleted?: (completion: GoalCompletion) => void;
}) {
  const [state, action, pending, submit] = useActionForm<ActionState>(
    goal ? updateGoalAction : createGoalAction,
    undefined,
  );
  // One form per goal row in edit mode -- fixed ids would collide; see useFieldId.
  const fieldId = useFieldId();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) {
      if (state?.completed) onCompleted?.(state.completed);
      onSuccess();
    }
    wasPending.current = pending;
  }, [pending, state, onSuccess, onCompleted]);

  return (
    <form
      action={action}
      onSubmit={submit}
      className="flex flex-col gap-5 rounded-2xl border border-hairline bg-surface p-5"
    >
      {goal ? <input type="hidden" name="id" value={goal.goal_id} /> : null}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">{goal ? "Edit goal" : "New goal"}</h2>
        <button
          type="button"
          onClick={onCancel}
          className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Cancel
        </button>
      </div>

      <FormField label="Name" htmlFor={fieldId("goal_name")} required>
        <Input
          id={fieldId("goal_name")}
          name="goal_name"
          required
          maxLength={60}
          placeholder="e.g. Japan trip"
          defaultValue={goal?.goal_name}
        />
      </FormField>

      <FormField label="Type" htmlFor={fieldId("goal_type")} required>
        <select
          id={fieldId("goal_type")}
          name="goal_type"
          required
          defaultValue={goal?.goal_type ?? ""}
          className={fieldClassName}
        >
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
        <FormField label="Target amount" htmlFor={fieldId("target_amount")} required>
          <Input
            id={fieldId("target_amount")}
            name="target_amount"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            required
            defaultValue={goal?.target_amount}
          />
        </FormField>

        <FormField label="Target date" htmlFor={fieldId("target_date")} hint="Optional">
          <input
            id={fieldId("target_date")}
            name="target_date"
            type="date"
            defaultValue={goal?.target_date ?? undefined}
            className={fieldClassName}
          />
        </FormField>
      </div>

      <FormField
        label="Monthly contribution"
        htmlFor={fieldId("monthly_contribution")}
        hint="Optional -- what you're aiming to put toward it each month."
      >
        <Input
          id={fieldId("monthly_contribution")}
          name="monthly_contribution"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          placeholder="0.00"
          defaultValue={goal?.monthly_contribution ?? undefined}
        />
      </FormField>

      {state?.error ? <ErrorMessage message={state.error} /> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : goal ? "Save changes" : "Add goal"}
      </Button>
    </form>
  );
}
