"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { callAction, useActionForm } from "@/components/useActionForm";
import {
  deleteContributionAction,
  updateContributionAction,
  type ActionState,
} from "@/lib/actions/goals";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Input, FIELD_EDGE } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { TrashIcon } from "@/components/ui/icons";
import { formatCurrency, formatDate } from "@/lib/format";
import type { GoalContribution } from "@/lib/db/goals";

const fieldClassName = `w-full ${FIELD_EDGE} bg-surface px-3 py-2 text-sm text-ink`;

const TEXT_BUTTON_BASE =
  "inline-flex min-h-11 items-center rounded px-1 text-sm font-medium text-ink-secondary transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
const TEXT_BUTTON = `${TEXT_BUTTON_BASE} hover:text-ink`;

// The goal's contributions, newest first. Editing or deleting one changes
// the goal's total and percentage because v_goal_progress sums this table
// on every read -- nothing here adjusts a total itself.
export function ContributionList({
  goalName,
  contributions,
}: {
  goalName: string;
  contributions: GoalContribution[];
}) {
  return (
    <ul className="flex flex-col divide-y divide-hairline rounded-xl border border-hairline bg-surface-raised">
      {contributions.map((contribution) => (
        <ContributionItem key={contribution.id} goalName={goalName} contribution={contribution} />
      ))}
    </ul>
  );
}

function ContributionItem({
  goalName,
  contribution,
}: {
  goalName: string;
  contribution: GoalContribution;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending, submit] = useActionForm<ActionState>(
    updateContributionAction,
    undefined,
  );
  const wasPending = useRef(false);

  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [isDeleting, startDelete] = useTransition();

  useEffect(() => {
    const succeeded = wasPending.current && !pending && !state?.error;
    wasPending.current = pending;
    if (succeeded) setEditing(false);
  }, [pending, state]);

  const amountText = formatCurrency(contribution.amount);
  const dateText = formatDate(contribution.date);

  // Set once the delete succeeds: this item and its Delete button are about
  // to go (and the whole history with the last one), so focus moves to the
  // goal's "Add contribution", which stays.
  const deleted = useRef(false);

  function handleDelete() {
    startDelete(async () => {
      const result = await callAction(() => deleteContributionAction(contribution.id));
      if (result?.error) {
        setDeleteError(result.error);
        setConfirming(false);
        return;
      }
      deleted.current = true;
      setConfirming(false);
    });
  }

  if (editing) {
    return (
      <li className="px-3 py-3">
        <form action={action} onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={contribution.id} />
          <FormField label="Date" htmlFor={`edit-date-${contribution.id}`}>
            <input
              id={`edit-date-${contribution.id}`}
              name="date"
              type="date"
              required
              defaultValue={contribution.date}
              className={fieldClassName}
            />
          </FormField>
          <FormField label="Amount" htmlFor={`edit-amount-${contribution.id}`}>
            <Input
              id={`edit-amount-${contribution.id}`}
              name="amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              required
              defaultValue={contribution.amount}
            />
          </FormField>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <button type="button" onClick={() => setEditing(false)} className={TEXT_BUTTON}>
            Cancel
          </button>
          {state?.error ? <ErrorMessage message={state.error} /> : null}
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-1 px-3 py-1">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-sm text-ink-secondary">{dateText}</span>
        <span className="text-sm font-medium tabular-nums text-ink">{amountText}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={TEXT_BUTTON}
          aria-label={`Edit ${amountText} on ${dateText}`}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => {
            setDeleteError(undefined);
            setConfirming(true);
          }}
          className={`${TEXT_BUTTON_BASE} hover:text-critical`}
          aria-label={`Delete ${amountText} on ${dateText}`}
        >
          Delete
        </button>
      </div>
      {deleteError ? <ErrorMessage message={deleteError} /> : null}

      <ConfirmDialog
        open={confirming}
        title={`Delete ${amountText} from ${goalName}, ${dateText}?`}
        description={`This can't be undone -- the contribution will be permanently removed, and ${goalName}'s total will go down by ${amountText}.`}
        confirmLabel={isDeleting ? "Deleting…" : "Delete"}
        confirmIcon={<TrashIcon className="h-4 w-4" />}
        cancelLabel="Cancel"
        tone="critical"
        busy={isDeleting}
        returnFocus={() =>
          deleted.current ? document.getElementById(`add-contribution-${contribution.goalid}`) : null
        }
        onConfirm={handleDelete}
        onCancel={() => setConfirming(false)}
      />
    </li>
  );
}
