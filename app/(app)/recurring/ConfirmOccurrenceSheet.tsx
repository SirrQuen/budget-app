"use client";

import { useEffect, useRef, useState } from "react";
import { callAction, useActionForm } from "@/components/useActionForm";
import { confirmDifferentlyAction, type ActionState } from "@/lib/actions/recurring";
import { countsTowardBalanceAction } from "@/lib/actions/transactions";
import type { ConfirmationQueueItem } from "@/lib/db/dashboard";
import { useToday } from "@/components/TodayProvider";
import { useConfirmPulse } from "@/components/ui/ConfirmPulse";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { BalanceDateNote } from "@/components/BalanceDateNote";

// "Landed differently": the amount and the date, both pre-filled with the
// prediction and both editable, whatever else changed -- the date matters
// as much as the amount (docs/Recurring-Confirmation.md). The date entered
// IS the transaction's date. For an approximate schedule the date comes
// first, since it's the part most likely to be wrong.
//
// The balance note asks SQL's anchor rule (counts_toward_balance_preview,
// migration 48) about each account the transaction lands on -- the same
// answer and the same note the transaction form shows. A date before an
// account's balance date is allowed; the note says what it means.
export function ConfirmOccurrenceSheet({
  item,
  trigger,
}: {
  item: ConfirmationQueueItem;
  trigger: (open: () => void) => React.ReactNode;
}) {
  const today = useToday();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const pulse = useConfirmPulse();
  const predictedDate = item.dueDate <= today ? item.dueDate : today;
  const [date, setDate] = useState(predictedDate);
  const [balanceAnswers, setBalanceAnswers] = useState<Record<string, boolean | null>>({});
  const asked = useRef(new Set<string>());

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

  // Once per account and date, only while open.
  const unasked = open && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? item.accounts.map((a) => `${a.id}|${date}`).filter((k) => !(k in balanceAnswers)).join(",")
    : "";
  useEffect(() => {
    if (unasked === "") return;
    for (const key of unasked.split(",")) {
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      const [accountId, d] = key.split("|");
      void callAction(() => countsTowardBalanceAction(accountId, d, null)).then((answer) => {
        setBalanceAnswers((prev) => ({ ...prev, [key]: typeof answer === "boolean" ? answer : null }));
      });
    }
  }, [unasked]);

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

            {item.accounts
              .filter((a) => balanceAnswers[`${a.id}|${date}`] === false)
              .map((a) => (
                <BalanceDateNote key={a.id} accountId={a.id} accountName={a.name} openingDate={a.openingDate} />
              ))}

            {state?.error ? <ErrorMessage message={state.error} /> : null}

            <Button type="submit" disabled={pending} className="self-start">
              {pending ? "Saving…" : "Save"}
            </Button>
          </form>
        ) : null}
      </dialog>
    </>
  );
}
