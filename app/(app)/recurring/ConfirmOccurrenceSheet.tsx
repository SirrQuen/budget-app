"use client";

import { useEffect, useRef, useState } from "react";
import { useActionForm } from "@/components/useActionForm";
import { confirmDifferentlyAction, type ActionState } from "@/lib/actions/recurring";
import type { ConfirmationQueueItem } from "@/lib/db/dashboard";
import { useToday } from "@/components/TodayProvider";
import { useConfirmPulse } from "@/components/ui/ConfirmPulse";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { PreAnchorQuestion, asksAnchorQuestion, useAnchorPreviews } from "@/components/PreAnchorQuestion";
import { PaymentNote } from "@/components/PaymentNote";
import { formatDate } from "@/lib/format";

// "Landed differently": the amount and the date, both pre-filled with the
// prediction and both editable, whatever else changed -- the date matters
// as much as the amount (docs/Recurring-Confirmation.md). The date entered
// IS the transaction's date. For an approximate schedule the date comes
// first, since it's the part most likely to be wrong.
//
// The pre-anchor question (migration 62) asks SQL's anchor rule
// (balance_anchor_preview) about each account the transaction lands on --
// the same question the transaction form asks. A date before an account's
// balance date is allowed, but needs the "already included?" answer.
export function ConfirmOccurrenceSheet({
  item,
  trigger,
  openRequest = 0,
}: {
  item: ConfirmationQueueItem;
  trigger: (open: () => void) => React.ReactNode;
  /** Bumped by the queue to open the sheet without its trigger (see above). */
  openRequest?: number;
}) {
  const today = useToday();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const pulse = useConfirmPulse();
  const predictedDate = item.dueDate <= today ? item.dueDate : today;
  const [date, setDate] = useState(predictedDate);

  // "It landed" found this occurrence dated before a balance date: it needs
  // the pre-anchor answer one tap can't give, so the queue opens the sheet.
  const lastRequest = useRef(openRequest);
  useEffect(() => {
    if (openRequest === lastRequest.current) return;
    lastRequest.current = openRequest;
    setDate(predictedDate);
    setOpen(true);
  }, [openRequest, predictedDate]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const [state, action, pending, submit] = useActionForm<ActionState>(confirmDifferentlyAction, undefined);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) {
      setOpen(false);
      pulse(item.kind === "Income" ? "income" : "default");
    }
    wasPending.current = pending;
  }, [pending, state, pulse, item.kind]);

  // Once per account and date, only while open. A new transaction, so no
  // transaction id: it would be recorded now.
  const anchorPreviews = useAnchorPreviews(
    item.accounts.map((a) => a.id),
    date,
    null,
    open,
  );

  const dateField = (
    <FormField label="Date it landed" htmlFor={`confirm-date-${item.recurringId}`} required>
      <Input
        id={`confirm-date-${item.recurringId}`}
        name="date"
        type="date"
        max={today}
        required
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
    </FormField>
  );
  const amountField = (
    <FormField label="Amount" htmlFor={`confirm-amount-${item.recurringId}`} required>
      <Input
        id={`confirm-amount-${item.recurringId}`}
        name="amount"
        type="number"
        inputMode="decimal"
        min="0.01"
        step="0.01"
        required
        defaultValue={item.amount > 0 ? item.amount.toFixed(2) : ""}
      />
    </FormField>
  );

  return (
    <>
      {trigger(() => {
        setDate(predictedDate);
        setOpen(true);
      })}

      <dialog
        ref={ref}
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        className="mx-auto my-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-hairline bg-surface p-0 text-ink backdrop:bg-scrim"
      >
        {/* Only mounted while open, so a reopen starts from the prediction. */}
        {open ? (
          <form action={action} onSubmit={submit} className="flex flex-col gap-4 p-5">
            <input type="hidden" name="id" value={item.recurringId} />
            <input type="hidden" name="due_date" value={item.dueDate} />

            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-ink">What landed for {item.name}?</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                Cancel
              </button>
            </div>

            {item.alreadyRecorded ? (
              <p className="text-sm text-ink-secondary">
                {item.name} already has a transaction on {formatDate(item.alreadyRecorded.date)}. If this is
                another one, enter the day it landed.
              </p>
            ) : null}

            {item.approximate ? (
              <>
                {dateField}
                {amountField}
              </>
            ) : (
              <>
                {amountField}
                {dateField}
              </>
            )}

            {item.accounts.map((a) => {
              const preview = anchorPreviews[a.id];
              return asksAnchorQuestion(preview) ? (
                <PreAnchorQuestion
                  key={`${a.id}|${date}`}
                  idPrefix={`confirm-${item.recurringId}`}
                  accountId={a.id}
                  accountName={a.name}
                  preview={preview}
                  nameAccount={item.accounts.length > 1}
                />
              ) : null;
            })}

            {state?.error ? <ErrorMessage message={state.error} /> : null}

            {item.payee ? <PaymentNote payees={[item.payee]} /> : null}

            <Button type="submit" disabled={pending} className="self-start">
              {pending ? "Saving…" : "Save"}
            </Button>
          </form>
        ) : null}
      </dialog>
    </>
  );
}
