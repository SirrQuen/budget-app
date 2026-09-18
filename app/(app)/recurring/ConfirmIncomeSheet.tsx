"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { confirmIncomeAction, type ActionState } from "@/lib/actions/recurring";
import { formatDate } from "@/lib/format";
import { useConfirmPulse } from "@/components/ui/ConfirmPulse";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

export type IncomeConfirmTarget = {
  id: string;
  /** The schedule's own description, e.g. "Emory University". */
  name: string;
  /** Prefill -- the schedule's fixed amount, or estimate_income_amount's estimate for a variable one. */
  estimatedAmount: number;
  /** True when estimatedAmount is a guess (amount_is_variable, unconfirmed) rather than a known figure. */
  isEstimate: boolean;
  /** next_due_date -- shown for context only; the actual transaction posts dated today. */
  dueDate: string;
};

// One field ("Did your paycheck land?"), reachable from three places -- the
// upcoming commitments list, a recurring row, and the dashboard prompt (see
// CLAUDE.md "Confirmation flow") -- each supplies its own trigger markup via
// the render-prop, same shape as ConfirmVariableAmountSheet. Confirming
// writes the transaction immediately (confirmIncomeOccurrence) rather than
// staging a pending amount -- there's no later "due date" moment to defer
// to for a schedule whose date itself might vary.
export function ConfirmIncomeSheet({
  target,
  trigger,
}: {
  target: IncomeConfirmTarget;
  trigger: (open: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const pulse = useConfirmPulse();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const [state, action, pending] = useActionState<ActionState, FormData>(
    confirmIncomeAction,
    undefined,
  );
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) {
      setOpen(false);
      pulse("income");
    }
    wasPending.current = pending;
  }, [pending, state, pulse]);

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
            schedule without the page re-rendering in between. */}
        {open ? (
          <form action={action} className="flex flex-col gap-4 p-5">
            <input type="hidden" name="id" value={target.id} />

            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-ink">Did your paycheck land?</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                Cancel
              </button>
            </div>

            <p className="text-sm text-ink-secondary">
              {target.name} · expected {formatDate(target.dueDate)}
              {target.isEstimate ? " · estimate" : ""}
            </p>

            <FormField label="Amount" htmlFor="confirm-income-amount" required>
              <Input
                id="confirm-income-amount"
                name="amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                required
                defaultValue={target.estimatedAmount.toFixed(2)}
              />
            </FormField>

            {state?.error ? <ErrorMessage message={state.error} /> : null}

            <Button type="submit" disabled={pending} className="self-start">
              {pending ? "Saving…" : "Yes, it landed"}
            </Button>
          </form>
        ) : null}
      </dialog>
    </>
  );
}
