"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { callAction, useActionForm } from "@/components/useActionForm";
import { useToday } from "@/components/TodayProvider";
import {
  archiveGoalAction,
  contributeToGoalAction,
  deleteGoalAction,
  type ContributeActionState,
} from "@/lib/actions/goals";
import { GoalMeter } from "@/components/ui/GoalMeter";
import { Celebration } from "@/components/ui/Celebration";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, FIELD_EDGE } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { CheckIcon, ChevronDownIcon, TargetIcon, TrashIcon } from "@/components/ui/icons";
import { formatCurrency, formatDate } from "@/lib/format";
import type { GoalProgress } from "@/lib/db/dashboard";
import type { GoalContribution } from "@/lib/db/goals";
import type { GoalCompletion } from "@/lib/goalCompletion";
import { ContributionList } from "./ContributionList";
import { GoalForm } from "./GoalForm";
import { GoalCompletePanel } from "./GoalCompletePanel";
import { NEW_GOAL_EVENT } from "./CreateGoalForm";

const fieldClassName = `w-full ${FIELD_EDGE} bg-surface px-3 py-2 text-sm text-ink`;

const TEXT_BUTTON_BASE =
  "-mx-2 inline-flex min-h-11 shrink-0 items-center self-start rounded px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:mx-0 sm:self-auto sm:px-0";
const TEXT_BUTTON = `${TEXT_BUTTON_BASE} hover:text-ink`;

// What the delete confirmation says goes with the goal -- the part people
// don't expect.
function deleteTitle(goalName: string, contributionCount: number): string {
  if (contributionCount === 0) return `Delete ${goalName}?`;
  return contributionCount === 1
    ? `Delete ${goalName} and its 1 contribution?`
    : `Delete ${goalName} and its ${contributionCount} contributions?`;
}

export function GoalRow({
  goal,
  contributions,
  completedOn,
}: {
  goal: GoalProgress;
  contributions: GoalContribution[];
  /** completed_at as the user's calendar day, or null while not complete. */
  completedOn: string | null;
}) {
  const today = useToday();
  const [contributing, setContributing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [state, action, pending, submit] = useActionForm<ContributeActionState>(
    contributeToGoalAction,
    undefined,
  );
  const [celebrate, setCelebrate] = useState(false);
  const [celebrateMessage, setCelebrateMessage] = useState("");
  const [milestoneCelebrate, setMilestoneCelebrate] = useState(false);
  const [milestoneMessage, setMilestoneMessage] = useState("");
  // Set only from a server action's response in this interaction -- the
  // one that completed the goal. Never derived from the goal's state, so a
  // reload or another device never shows it.
  const [completion, setCompletion] = useState<GoalCompletion | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);
  const celebrateTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const milestoneTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const succeeded = wasPending.current && !pending && !state?.error;
    const milestone = state?.milestone;
    wasPending.current = pending;

    if (succeeded) {
      formRef.current?.reset();
      setContributing(false);
    }
    if (succeeded && state?.completed) {
      setCompletion(state.completed);
    }
    if (succeeded && milestone) {
      setCelebrateMessage(milestone.message);
      setCelebrate(true);
      clearTimeout(celebrateTimeout.current);
      celebrateTimeout.current = setTimeout(() => setCelebrate(false), 1800);
    }
  }, [pending, state]);

  useEffect(() => () => clearTimeout(celebrateTimeout.current), []);
  useEffect(() => () => clearTimeout(milestoneTimeout.current), []);

  function handleMilestone(milestone: { pct: number; message: string }) {
    setMilestoneMessage(milestone.message);
    setMilestoneCelebrate(true);
    clearTimeout(milestoneTimeout.current);
    milestoneTimeout.current = setTimeout(() => setMilestoneCelebrate(false), 1800);
  }

  const [editing, setEditing] = useState(false);
  const closeEdit = useCallback(() => setEditing(false), []);

  // "Set the next one": the edit form opens with focus on the target.
  const focusTarget = useRef(false);
  const editRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (editing && focusTarget.current) {
      focusTarget.current = false;
      editRef.current?.querySelector<HTMLInputElement>('input[name="target_amount"]')?.focus();
    }
  }, [editing]);

  // Closing hands focus back to the goal, which is still right here.
  function closeCompletion() {
    setCompletion(null);
    document.getElementById(`add-contribution-${goal.goal_id}`)?.focus();
  }

  function completionPrimary() {
    const next = completion?.next;
    setCompletion(null);
    if (next === "set-next") {
      focusTarget.current = true;
      setEditing(true);
    } else {
      window.dispatchEvent(new Event(NEW_GOAL_EVENT));
    }
  }

  const panel = completion ? (
    <GoalCompletePanel completion={completion} onClose={closeCompletion} onPrimary={completionPrimary} />
  ) : null;

  const [archiveError, setArchiveError] = useState<string>();
  const [isArchiving, startArchive] = useTransition();

  // Archive leaves the contributions alone and takes the goal off this
  // page, so focus goes to the page heading, as it does after a delete.
  function handleArchive() {
    setArchiveError(undefined);
    startArchive(async () => {
      const result = await callAction(() => archiveGoalAction(goal.goal_id ?? ""));
      if (result?.error) {
        setArchiveError(result.error);
      } else {
        document.getElementById("page-title")?.focus();
      }
    });
  }
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [isDeleting, startDelete] = useTransition();
  // Set once the delete succeeds: this row and its Delete button are about
  // to go, so focus moves to the page heading, which every state of the
  // page keeps (the last goal leaves the empty state behind it).
  const deleted = useRef(false);

  function handleDelete() {
    startDelete(async () => {
      const result = await callAction(() => deleteGoalAction(goal.goal_id ?? ""));
      if (result?.error) {
        setDeleteError(result.error);
      } else {
        deleted.current = true;
      }
      setConfirmingDelete(false);
    });
  }

  const target = goal.target_amount ?? 0;
  const contributed = goal.contributed_amount ?? 0;
  const remaining = goal.remaining_amount ?? 0;
  const pct = goal.pct_complete ?? 0;
  const goalName = goal.goal_name ?? "this goal";

  if (editing) {
    return (
      <li ref={editRef} className="px-4 py-4">
        {panel}
        <GoalForm
          goal={{
            goal_id: goal.goal_id ?? "",
            goal_name: goal.goal_name ?? "",
            goal_type: goal.goal_type ?? "",
            target_amount: target,
            target_date: goal.target_date,
            monthly_contribution: goal.monthly_contribution,
          }}
          onSuccess={closeEdit}
          onCancel={closeEdit}
          onCompleted={setCompletion}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-3 px-4 py-4 transition-colors duration-150 hover:bg-surface-raised">
      {/* Below sm the action drops onto its own line beneath the name so it
          stops competing with the goal name for width and gets a 44px tap
          target; inline on the right from sm up. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex min-w-0 items-center gap-3 sm:flex-1">
          <TargetIcon className="h-4 w-4 shrink-0 text-ink-secondary" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{goal.goal_name}</span>
          <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-xs font-medium text-ink-muted">
            {goal.goal_type}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <button
            type="button"
            id={`add-contribution-${goal.goal_id}`}
            onClick={() => setContributing((v) => !v)}
            className={TEXT_BUTTON}
          >
            {contributing ? "Cancel" : "Add contribution"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={TEXT_BUTTON}
            aria-label={`Edit ${goalName}`}
          >
            Edit
          </button>
          {completedOn ? (
            <button
              type="button"
              onClick={handleArchive}
              disabled={isArchiving}
              className={TEXT_BUTTON}
              aria-label={`Archive ${goalName}`}
            >
              {isArchiving ? "Archiving…" : "Archive"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setDeleteError(undefined);
              setConfirmingDelete(true);
            }}
            className={`${TEXT_BUTTON_BASE} hover:text-critical`}
            aria-label={`Delete ${goalName}`}
          >
            Delete
          </button>
        </div>
      </div>
      {deleteError ? <ErrorMessage message={deleteError} /> : null}
      {archiveError ? <ErrorMessage message={archiveError} /> : null}

      <GoalMeter
        goalId={goal.goal_id ?? ""}
        goalName={goal.goal_name ?? "This goal"}
        value={pct}
        onMilestone={handleMilestone}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-ink-secondary">
          {formatCurrency(contributed)} of {formatCurrency(target)} saved
        </span>
        <span className="text-ink-secondary">
          {completedOn ? (
            <span className="inline-flex items-center gap-1">
              <CheckIcon className="h-4 w-4" aria-hidden="true" />
              Completed {formatDate(completedOn)}
            </span>
          ) : remaining > 0 ? (
            `${formatCurrency(remaining)} to go`
          ) : (
            "Goal reached"
          )}
        </span>
      </div>

      {contributions.length > 0 ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            aria-controls={`history-${goal.goal_id}`}
            className="-mx-2 inline-flex min-h-11 items-center gap-1 self-start rounded px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <ChevronDownIcon
              className={`h-4 w-4 motion-safe:transition-transform motion-safe:duration-150 ${showHistory ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
            {contributions.length === 1 ? "1 contribution" : `${contributions.length} contributions`}
          </button>
          {showHistory ? (
            <div id={`history-${goal.goal_id}`}>
              <ContributionList
                goalName={goal.goal_name ?? "this goal"}
                contributions={contributions}
                onCompleted={setCompletion}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {contributing ? (
        <form
          ref={formRef}
          action={action}
          onSubmit={submit}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-hairline bg-surface-raised p-3"
        >
          <input type="hidden" name="goalid" value={goal.goal_id ?? ""} />
          <FormField label="Date" htmlFor={`date-${goal.goal_id}`}>
            <input
              id={`date-${goal.goal_id}`}
              name="date"
              type="date"
              required
              defaultValue={today}
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

      <ConfirmDialog
        open={confirmingDelete}
        title={deleteTitle(goalName, contributions.length)}
        description={
          contributions.length > 0
            ? `This can't be undone -- the goal and its ${formatCurrency(contributed)} of contributions will be permanently removed.`
            : "This can't be undone -- the goal will be permanently removed."
        }
        confirmLabel={isDeleting ? "Deleting…" : "Delete"}
        confirmIcon={<TrashIcon className="h-4 w-4" />}
        cancelLabel="Cancel"
        tone="critical"
        busy={isDeleting}
        returnFocus={() => (deleted.current ? document.getElementById("page-title") : null)}
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />

      {panel}
      <Celebration show={celebrate} message={celebrateMessage} icon="✦" />
      <Celebration show={milestoneCelebrate} message={milestoneMessage} icon="✦" />
    </li>
  );
}
