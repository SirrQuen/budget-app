"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { confirmVariableAmountAction, type ActionState } from "@/lib/actions/recurring";
import { statementDateForCycle } from "@/lib/recurringSchedule";
import { formatDate } from "@/lib/format";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

export type VariableAmountTarget = {
  id: string;
  cardName: string;
  /** Prefill -- the live estimate off the card's current balance (see estimateCardPaymentDue). */
  estimatedAmount: number;
  statementDay: number;
  /** next_run_date -- shown for context, not editable here. */
  dueDate: string;
};

// A single-field sheet, reachable from three places (the upcoming
// commitments list, a recurring row, and the dashboard prompt -- see
// CLAUDE.md "Confirm flow") -- each supplies its own trigger markup via the
// render-prop rather than this component owning one fixed button style.
// Same native-<dialog> shell as MakeRecurringButton/ConfirmDialog.
export function ConfirmVariableAmountSheet({
  target,
  trigger,
}: {
  target: VariableAmountTarget;
  trigger: (open: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const [state, action, pending] = useActionState<ActionState, FormData>(
    confirmVariableAmountAction,
    undefined,
  );
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) {
      setOpen(false);
    }
    wasPending.current = pending;
  }, [pending, state]);

  const statementDateISO = statementDateForCycle(target.dueDate, target.statementDay);

  return (
    <>
      {trigger(() => setOpen(true))}

      <dialog
        ref={ref}
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        className="mx-auto my-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-hairline bg-surface p-0 text-ink backdrop:bg-scrim"
      >
        {/* Only mounted while open -- the amount field's defaultValue
            shouldn't hold a stale estimate across reopens for a different
            card without the page re-rendering in between. */}
        {open ? (
          <form action={action} className="flex flex-col gap-4 p-5">
            <input type="hidden" name="id" value={target.id} />

            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-ink">{target.cardName}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                Cancel
              </button>
            </div>

            <p className="text-sm text-ink-secondary">
              Statement posted {formatDate(statementDateISO)} · due {formatDate(target.dueDate)}
            </p>

            <FormField label="Amount due" htmlFor="confirm-variable-amount" required>
              <Input
                id="confirm-variable-amount"
                name="amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                required
                defaultValue={target.estimatedAmount.toFixed(2)}
              />
            </FormField>

            {state?.error ? <ErrorMessage message={state.error} /> : null}

            <Button type="submit" disabled={pending} className="self-start">
              {pending ? "Saving…" : "Confirm amount"}
            </Button>
          </form>
        ) : null}
      </dialog>
    </>
  );
}
