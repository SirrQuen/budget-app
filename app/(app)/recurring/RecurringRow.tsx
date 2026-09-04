"use client";

import { useState, useTransition } from "react";
import { RecurringForm, type EditableRecurring } from "./RecurringForm";
import {
  deleteRecurringAction,
  pauseRecurringAction,
  resumeRecurringAction,
} from "@/lib/actions/recurring";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PauseIcon, PlayIcon, TransferIcon, TrashIcon } from "@/components/ui/icons";
import { formatCurrency, formatDate } from "@/lib/format";
import { formatSchedule, formatEndCondition } from "@/lib/recurringSchedule";
import type { RecurringWithRelations } from "@/lib/db/recurring";
import type { TransactionType } from "@/lib/db/transactions";
import type { CategoryWithGroup } from "@/lib/db/categories";
import type { TransactionAccountOption } from "../transactions/AddTransactionForm";

export function RecurringRow({
  recurring,
  incomeCategories,
  expenseCategories,
  accounts,
}: {
  recurring: RecurringWithRelations;
  incomeCategories: CategoryWithGroup[];
  expenseCategories: CategoryWithGroup[];
  accounts: TransactionAccountOption[];
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [isDeleting, startDelete] = useTransition();
  const [toggleError, setToggleError] = useState<string>();
  const [isToggling, startToggle] = useTransition();

  function handleDelete() {
    startDelete(async () => {
      const result = await deleteRecurringAction(recurring.id);
      if (result?.error) {
        setDeleteError(result.error);
        return;
      }
      setConfirmingDelete(false);
    });
  }

  function handleToggle() {
    setToggleError(undefined);
    startToggle(async () => {
      const result = recurring.is_active
        ? await pauseRecurringAction(recurring.id)
        : await resumeRecurringAction(recurring.id);
      if (result?.error) {
        setToggleError(result.error);
      }
    });
  }

  const isTransfer = recurring.to_accountid !== null;

  if (editing) {
    const editable: EditableRecurring = {
      id: recurring.id,
      description: recurring.description,
      amount: Number(recurring.amount),
      kind: isTransfer ? "Transfer" : ((recurring.category_type as TransactionType) ?? "Expense"),
      categoryid: recurring.categoryid,
      accountid: recurring.accountid,
      to_accountid: recurring.to_accountid,
      frequency: recurring.frequency,
      interval_count: recurring.interval_count,
      next_run_date: recurring.next_run_date,
      occurrence_limit: recurring.occurrence_limit,
      end_date: recurring.end_date,
    };
    return (
      <li className="p-4">
        <RecurringForm
          recurring={editable}
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
          accounts={accounts}
          onSuccess={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  const endCondition = formatEndCondition(recurring.occurrence_limit, recurring.end_date);

  return (
    <li
      className={`flex flex-col gap-3 px-4 py-4 transition-colors duration-150 hover:bg-surface-raised ${recurring.is_active ? "" : "opacity-60"}`}
    >
      {/* Below sm the actions drop onto their own line, same reflow as
          BudgetRow/AccountRow -- Edit / Pause / Delete stop competing with
          the description for width and each keeps a 44px tap target. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex min-w-0 items-center gap-3 sm:flex-1">
          {isTransfer ? (
            <TransferIcon className="h-4 w-4 shrink-0 text-ink-secondary" aria-hidden="true" />
          ) : (
            <CategoryIcon icon={recurring.category_icon} className="h-4 w-4 shrink-0 text-ink-secondary" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{recurring.description}</span>
          {!recurring.is_active ? (
            <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-xs font-medium text-ink-muted">
              Paused
            </span>
          ) : null}
          <span className="shrink-0 text-sm font-medium tabular-nums text-ink">
            {formatCurrency(Number(recurring.amount))}
          </span>
        </div>
        <div className="-mx-2 flex shrink-0 items-center gap-1 sm:mx-0 sm:gap-3">
          {deleteError ? <span className="px-2 text-sm text-critical sm:px-0">{deleteError}</span> : null}
          {toggleError ? <span className="px-2 text-sm text-critical sm:px-0">{toggleError}</span> : null}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex min-h-11 items-center rounded px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:px-0"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={handleToggle}
            disabled={isToggling}
            className="inline-flex min-h-11 items-center gap-1.5 rounded px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50 sm:px-0"
          >
            {recurring.is_active ? (
              <PauseIcon className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <PlayIcon className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {isToggling ? "Saving…" : recurring.is_active ? "Pause" : "Resume"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="inline-flex min-h-11 items-center rounded px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:px-0"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-secondary">
        <span>
          {isTransfer
            ? `${recurring.account_name ?? "…"} → ${recurring.to_account_name ?? "…"}`
            : `${recurring.category_name ?? "Uncategorized"} · ${recurring.account_name ?? "—"}`}
        </span>
        <span>
          {formatSchedule(
            recurring.frequency,
            // The stable anchor, not the live cursor -- next_run_date can
            // sit on a clamped day (Feb 28 for a 31st-of-the-month bill)
            // while the schedule's own day is still the 31st. See
            // lib/db/recurring.ts's addMonthsClampedISO.
            recurring.start_date ?? recurring.next_run_date,
            recurring.interval_count,
          )}
        </span>
      </div>

      <p className="text-sm text-ink-muted">
        Next due {formatDate(recurring.next_run_date)}
        {endCondition ? ` · ${endCondition.charAt(0).toLowerCase()}${endCondition.slice(1)}` : ""}
      </p>

      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete the "${recurring.description}" schedule?`}
        description="This removes the schedule. Transactions it already generated stay in your history -- they just won't say where they came from anymore."
        confirmLabel={isDeleting ? "Deleting…" : "Delete"}
        confirmIcon={<TrashIcon className="h-4 w-4" aria-hidden="true" />}
        cancelLabel="Cancel"
        tone="critical"
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </li>
  );
}
