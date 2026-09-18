"use client";

import { useState, useTransition } from "react";
import { RecurringForm, type EditableRecurring } from "./RecurringForm";
import { ConfirmVariableAmountSheet } from "./ConfirmVariableAmountSheet";
import { ConfirmIncomeSheet } from "./ConfirmIncomeSheet";
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
  /** todayISO(), for deciding whether an unconfirmed variable schedule is already overdue. */
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
  // Transfer only -- amount_is_variable now also covers a variable-amount
  // Income schedule (29_recurring_income_confirmation.sql), which has its
  // own confirmation chip below (needsIncomeConfirmation) and never sets
  // next_amount_confirmed_at, so without this guard both blocks rendered
  // for the same Income row.
  const needsConfirmation =
    isTransfer && recurring.amount_is_variable && recurring.next_amount_confirmed_at === null;
  const isOverdueNeedsAmount = needsConfirmation && recurring.next_run_date <= today;
  const displayAmount = !recurring.amount_is_variable
    ? Number(recurring.amount)
    : recurring.next_amount_confirmed_at !== null
      ? Number(recurring.next_amount)
      : estimatedAmount;
  // Every Income schedule requires confirmation, always (CLAUDE.md
  // "Auto-create outflows. Confirm inflows.") -- unlike the card-payment
  // chip above, not gated on amount_is_variable: even a fixed-amount,
  // fixed-date paycheck still needs a "did it land?" before it posts.
  // Always shown, like the card chip -- the recurring row is a manual
  // override, not gated to the dashboard prompt's own confirmation window.
  const needsIncomeConfirmation = !isTransfer && recurring.requires_confirmation;
  const isOverdueNeedsConfirmation = needsIncomeConfirmation && recurring.next_due_date <= today;

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
      <li className="p-4 sm:col-span-5">
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

  return (
    <li
      className={`flex flex-col gap-3 px-4 py-4 transition-colors duration-150 hover:bg-surface-raised sm:col-span-5 sm:grid sm:grid-cols-subgrid sm:grid-flow-row-dense sm:items-center sm:gap-y-0 sm:px-0 sm:py-0 sm:min-h-[52px] ${recurring.is_active ? "" : "opacity-60"}`}
    >
      {/* Below sm the actions drop onto their own line, same reflow as
          AccountRow/CategoryRow -- sm:contents dissolves these wrappers
          from sm up so their children land directly in the row's five
          subgrid columns (name, schedule, next due, amount, actions).
          Each promoted cell gets an explicit sm:col-start so nesting name
          and amount together for the mobile line doesn't disturb the
          desktop column order. */}
      <div className="flex flex-col gap-2 sm:contents">
        <div className="flex items-start justify-between gap-3 sm:contents">
          <div className="flex min-w-0 items-center gap-3 sm:col-start-1 sm:min-w-0">
            {isTransfer ? (
              <TransferIcon className="h-4 w-4 shrink-0 text-ink-secondary" aria-hidden="true" />
            ) : (
              <CategoryIcon icon={recurring.category_icon} className="h-4 w-4 shrink-0 text-ink-secondary" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-ink">{recurring.description}</span>
                {!recurring.is_active ? (
                  <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-xs font-medium text-ink-muted">
                    Paused
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-sm text-ink-muted">
                {isTransfer
                  ? `${recurring.account_name ?? "…"} → ${recurring.to_account_name ?? "…"}`
                  : `${recurring.category_name ?? "Uncategorized"} · ${recurring.account_name ?? "—"}`}
              </p>
            </div>
          </div>

          <span className="shrink-0 text-right text-sm font-medium tabular-nums text-ink sm:col-start-4 sm:justify-self-end">
            {formatCurrency(displayAmount)}
          </span>
        </div>

        <span className="text-sm text-ink-secondary sm:col-start-2 sm:justify-self-start">
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

        <div className="text-sm text-ink-secondary sm:col-start-3 sm:justify-self-start">
          <p>Due {formatDate(recurring.next_due_date)}</p>
          {endCondition ? <p className="text-xs text-ink-muted">{endCondition}</p> : null}
        </div>
      </div>

      <div className="-mx-2 flex shrink-0 items-center gap-1 sm:col-start-5 sm:mx-0 sm:justify-self-end sm:gap-3">
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

      {/* An occasional call-to-action, not a column -- it gets its own full-
          width line below the row rather than squeezing into one of the
          five tracks above. */}
      {needsConfirmation ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm sm:col-span-5">
          <span className="inline-flex items-center gap-1.5 text-ink-muted">
            <InfoIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {isOverdueNeedsAmount
              ? "Needs your amount before it can post"
              : "Estimate -- confirm once the statement posts"}
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
                Confirm amount
              </button>
            )}
          />
        </div>
      ) : null}

      {needsIncomeConfirmation ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm sm:col-span-5">
          <span className="inline-flex items-center gap-1.5 text-ink-muted">
            <InfoIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {isOverdueNeedsConfirmation
              ? "Should have landed by now -- confirm when it does"
              : recurring.amount_is_variable
                ? "Estimate -- confirm once it lands"
                : "Confirm once it lands"}
          </span>
          <ConfirmIncomeSheet
            target={{
              id: recurring.id,
              name: recurring.description,
              estimatedAmount,
              isEstimate: recurring.amount_is_variable,
              dueDate: recurring.next_due_date,
            }}
            trigger={(open) => (
              <button
                type="button"
                onClick={open}
                className="shrink-0 rounded-full bg-surface-raised px-3 py-1 text-xs font-medium text-ink transition-colors duration-150 hover:bg-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                Confirm
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
