"use client";

import { useState, useTransition } from "react";
import { RecurringForm, type EditableRecurring } from "./RecurringForm";
import { ConfirmVariableAmountSheet } from "./ConfirmVariableAmountSheet";
import {
  deleteRecurringAction,
  pauseRecurringAction,
  resumeRecurringAction,
} from "@/lib/actions/recurring";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PauseIcon, PlayIcon, TransferIcon, TrashIcon, InfoIcon } from "@/components/ui/icons";
import { formatCurrency, formatDate } from "@/lib/format";
import { formatSchedule, formatEndCondition } from "@/lib/recurringSchedule";
import type { RecurringWithRelations } from "@/lib/db/recurring";
import type { TransactionType } from "@/lib/db/transactions";
import type { CategoryWithGroup } from "@/lib/db/categories";
import type { TransactionAccountOption } from "../transactions/AddTransactionForm";
import { callAction } from "@/components/useActionForm";

export function RecurringRow({
  recurring,
  incomeCategories,
  expenseCategories,
  accounts,
  holidays = [],
  estimatedAmount,
  today,
}: {
  recurring: RecurringWithRelations;
  incomeCategories: CategoryWithGroup[];
  expenseCategories: CategoryWithGroup[];
  accounts: TransactionAccountOption[];
  /** ISO dates, for RecurringForm's live timing preview -- see its own doc comment. */
  holidays?: string[];
  /**
   * The live estimate for a variable-amount schedule -- a card-balance
   * estimate for a transfer, estimate_income_amount's mean-of-last-3 for an
   * Income schedule. Only meaningful while amount_is_variable; ignored
   * (recurring.amount is used instead) for a fixed-amount schedule.
   */
  estimatedAmount: number;
  /** getToday(), for deciding whether an unconfirmed variable schedule is already overdue. */
  today: string;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [isDeleting, startDelete] = useTransition();
  const [toggleError, setToggleError] = useState<string>();
  const [isToggling, startToggle] = useTransition();

  function handleDelete() {
    startDelete(async () => {
      const result = await callAction(() => deleteRecurringAction(recurring.id));
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
        ? await callAction(() => pauseRecurringAction(recurring.id))
        : await callAction(() => resumeRecurringAction(recurring.id));
      if (result?.error) {
        setToggleError(result.error);
      }
    });
  }

  const isTransfer = recurring.to_accountid !== null;
  // A variable card payment waiting on its statement amount -- Transfer
  // only (amount_is_variable also covers Income and Expense schedules,
  // which never set next_amount). Entering it revises the expected
  // payment; the payment itself is confirmed in the queue like anything
  // else.
  const needsConfirmation =
    isTransfer && recurring.amount_is_variable && recurring.next_amount_confirmed_at === null;
  const isOverdueNeedsAmount = needsConfirmation && recurring.next_run_date <= today;
  const displayAmount = !recurring.amount_is_variable
    ? Number(recurring.amount)
    : recurring.next_amount_confirmed_at !== null
      ? Number(recurring.next_amount)
      : estimatedAmount;
  // A variable-amount Expense schedule (31_recurring_expense_variability.sql)
  // has no statement amount to enter, unlike the card case above. Still
  // needs SOME visible marker that displayAmount is a guess rather than a
  // known figure (CLAUDE.md "Display"), hence this inline label instead.
  const isEstimatedExpenseSchedule =
    !isTransfer && recurring.category_type === "Expense" && recurring.amount_is_variable;

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
      amount_is_variable: recurring.amount_is_variable,
      statement_day: recurring.statement_day,
      date_tolerance_days: recurring.date_tolerance_days,
      business_day_offset: recurring.business_day_offset,
      non_business_day_rule: recurring.non_business_day_rule,
    };
    return (
      <li className="p-4 @4xl:col-span-5">
        <RecurringForm
          recurring={editable}
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
          accounts={accounts}
          holidays={holidays}
          onSuccess={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  const endCondition = formatEndCondition(recurring.occurrence_limit, recurring.end_date);
  const subtitle = isTransfer
    ? `${recurring.account_name ?? "…"} → ${recurring.to_account_name ?? "…"}`
    : `${recurring.category_name ?? "Uncategorized"} · ${recurring.account_name ?? "—"}`;

  return (
    <li
      className={`flex flex-col gap-3 px-4 py-4 transition-colors duration-150 hover:bg-surface-raised @4xl:col-span-5 @4xl:grid @4xl:grid-cols-subgrid @4xl:grid-flow-row-dense @4xl:items-center @4xl:gap-y-0 @4xl:px-0 @4xl:py-0 @4xl:min-h-[52px] ${recurring.is_active ? "" : "opacity-60"}`}
    >
      {/* Keyed to the LIST's width (@container in recurring/page.tsx), not
          the viewport: five columns need ~56rem, and at sm the sidebar
          left the name ~30px at 200% zoom. Below @4xl the actions drop onto
          their own line, same reflow as AccountRow/CategoryRow --
          @4xl:contents dissolves these wrappers from @4xl up so their
          children land directly in the row's five
          subgrid columns (name, schedule, next due, amount, actions).
          Each promoted cell gets an explicit @4xl:col-start so nesting name
          and amount together for the mobile line doesn't disturb the
          desktop column order. */}
      <div className="flex flex-col gap-2 @4xl:contents">
        <div className="flex items-start justify-between gap-3 @4xl:contents">
          <div className="flex min-w-0 items-center gap-3 @4xl:col-start-1 @4xl:min-w-0">
            {isTransfer ? (
              <TransferIcon className="h-4 w-4 shrink-0 text-ink-secondary" aria-hidden="true" />
            ) : (
              <CategoryIcon icon={recurring.category_icon} className="h-4 w-4 shrink-0 text-ink-secondary" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {/* Wraps below @4xl, truncates from @4xl up: beside the
                    amount, a 320px viewport cut the description to ~130px. */}
                <span title={recurring.description ?? undefined} className="min-w-0 break-words text-sm font-medium text-ink @4xl:truncate">{recurring.description}</span>
                {!recurring.is_active ? (
                  <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-xs font-medium text-ink-muted">
                    Paused
                  </span>
                ) : null}
              </div>
              <p title={subtitle} className="mt-0.5 break-words text-sm text-ink-muted @4xl:truncate">
                {subtitle}
              </p>
            </div>
          </div>

          <span className="shrink-0 text-right text-sm font-medium tabular-nums text-ink @4xl:col-start-4 @4xl:justify-self-end">
            {formatCurrency(displayAmount)}
            {isEstimatedExpenseSchedule ? (
              <span className="ml-1 text-xs font-normal text-ink-muted">est.</span>
            ) : null}
          </span>
        </div>

        <span className="text-sm text-ink-secondary @4xl:col-start-2 @4xl:justify-self-start">
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

        <div className="text-sm text-ink-secondary @4xl:col-start-3 @4xl:justify-self-start">
          <p>Due {formatDate(recurring.next_due_date)}</p>
          {endCondition ? <p className="text-xs text-ink-muted">{endCondition}</p> : null}
        </div>
      </div>

      <div className="-mx-2 flex shrink-0 items-center gap-1 @4xl:col-start-5 @4xl:mx-0 @4xl:justify-self-end @4xl:gap-3">
        {deleteError ? <span className="px-2 text-sm text-critical @4xl:px-0">{deleteError}</span> : null}
        {toggleError ? <span className="px-2 text-sm text-critical @4xl:px-0">{toggleError}</span> : null}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex min-h-11 items-center rounded px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface @4xl:px-0"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={handleToggle}
          disabled={isToggling}
          className="inline-flex min-h-11 items-center gap-1.5 rounded px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50 @4xl:px-0"
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
          className="inline-flex min-h-11 items-center rounded px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface @4xl:px-0"
        >
          Delete
        </button>
      </div>

      {/* An occasional call-to-action, not a column -- it gets its own full-
          width line below the row rather than squeezing into one of the
          five tracks above. */}
      {needsConfirmation ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm @4xl:col-span-5">
          <span className="inline-flex items-center gap-1.5 text-ink-muted">
            <InfoIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {isOverdueNeedsAmount
              ? "Estimate -- enter the statement amount if you have it"
              : "Estimate -- enter the amount once the statement is out"}
          </span>
          <ConfirmVariableAmountSheet
            target={{
              id: recurring.id,
              cardName: recurring.to_account_name ?? "the card",
              estimatedAmount,
              statementDay: recurring.statement_day ?? 1,
              dueDate: recurring.next_run_date,
            }}
            trigger={(open) => (
              <button
                type="button"
                onClick={open}
                className="shrink-0 rounded-full bg-surface-raised px-3 py-1 text-xs font-medium text-ink transition-colors duration-150 hover:bg-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                Enter amount
              </button>
            )}
          />
        </div>
      ) : null}

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
