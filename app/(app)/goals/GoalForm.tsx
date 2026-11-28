"use client";

import { useEffect, useRef, useState } from "react";
import { useActionForm } from "@/components/useActionForm";
import { createGoalAction, updateGoalAction, type ActionState } from "@/lib/actions/goals";
import type { GoalCompletion } from "@/lib/goalCompletion";
import { GOAL_TYPES } from "@/lib/goalOptions";
import { FormField, useFieldId } from "@/components/ui/FormField";
import { Input, FIELD_CLASS } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import type { FeedingSchedule } from "@/lib/db/goals";
import { duplicateOf, duplicateQuestion, scheduleLabel } from "@/lib/goalSchedules";

const fieldClassName = FIELD_CLASS;

/** The fields an edit pre-fills -- a v_goal_progress row carries all of them. */
export type EditableGoal = {
  goal_id: string;
  goal_name: string;
  goal_type: string;
  target_amount: number;
  target_date: string | null;
  monthly_contribution: number | null;
  /** The card it follows (migration 70), so the form can say what a type change does. */
  follows_card?: string | null;
};

// Create and edit share one form, like CategoryForm/AccountForm, so the two
// can't accept different fields. With `goal` it edits that goal.
export function GoalForm({
  goal,
  fundingTransfers,
  onSuccess,
  onCancel,
  onCompleted,
}: {
  goal?: EditableGoal;
  /**
   * Live recurring transfers safe to spend counts, each with the goal it
   * feeds (listFeedingSchedules). The picker offers only the ones feeding
   * nothing: adding one here never takes it from another goal.
   */
  fundingTransfers: FeedingSchedule[];
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
  // Controlled so the "link it" prompt appears the moment a target is typed.
  const [monthly, setMonthly] = useState(goal?.monthly_contribution != null ? String(goal.monthly_contribution) : "");
  const hasMonthlyTarget = Number(monthly) > 0;
  // The link lives on the schedule (migration 82): this form only ADDS an
  // unlinked one. Clearing the monthly target unlinks nothing -- the goal's
  // schedules stay in its "Funded by" list, where each can be unlinked.
  const unlinked = fundingTransfers.filter((t) => t.goalId === null);
  const feedingThis = goal ? fundingTransfers.filter((t) => t.goalId === goal.goal_id) : [];
  const [addId, setAddId] = useState("");
  const adding = unlinked.find((t) => t.id === addId);
  const duplicate = adding ? duplicateOf(adding, feedingThis) : undefined;

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

      <FormField
        label="Type"
        htmlFor={fieldId("goal_type")}
        required
        hint={
          goal?.follows_card
            ? `Changing the type stops it following ${goal.follows_card}. What it has paid off stays as a contribution.`
            : undefined
        }
      >
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
          value={monthly}
          onChange={(e) => setMonthly(e.target.value)}
        />
      </FormField>

      {/* Asked in the same step as the target. A link the user has to
          remember to make won't exist; linked, this month's transfers count
          toward the target instead of it being set aside as well. */}
      {unlinked.length > 0 ? (
        <FormField
          label={feedingThis.length > 0 ? "Add another recurring transfer?" : "Do you move this money automatically?"}
          htmlFor={fieldId("add_schedule_id")}
          hint="Each transfer counts toward this goal once you confirm it, and safe to spend counts this month's toward the target, so the money isn't set aside twice."
        >
          <select
            id={fieldId("add_schedule_id")}
            name="add_schedule_id"
            value={addId}
            onChange={(e) => setAddId(e.target.value)}
            className={fieldClassName}
          >
            <option value="">{feedingThis.length > 0 ? "No" : "No, I add it myself"}</option>
            {unlinked.map((t) => (
              <option key={t.id} value={t.id}>
                {t.description} · {scheduleLabel(t)}
              </option>
            ))}
          </select>
        </FormField>
      ) : hasMonthlyTarget && feedingThis.length === 0 ? (
        <p className="text-sm text-ink-secondary">
          Do you move this money automatically? If you set up a recurring transfer for it, link it here so
          it isn&apos;t set aside twice.
        </p>
      ) : null}

      {duplicate ? (
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 text-ink-secondary">{duplicateQuestion(duplicate)}</legend>
          <input type="hidden" name="duplicate_asked" value="1" />
          <label className="flex items-center gap-2 text-ink">
            <input type="radio" name="add_duplicate" value="yes" required /> Yes, add it as well
          </label>
          <label className="flex items-center gap-2 text-ink">
            <input type="radio" name="add_duplicate" value="no" required /> No, leave it unlinked
          </label>
        </fieldset>
      ) : null}

      {state?.error ? <ErrorMessage message={state.error} /> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : goal ? "Save changes" : "Add goal"}
      </Button>
    </form>
  );
}
