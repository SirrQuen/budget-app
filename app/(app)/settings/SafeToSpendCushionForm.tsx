"use client";

import { useActionState, useId } from "react";
import {
  setSafeToSpendCushionAction,
  type SafeToSpendCushionActionState,
} from "@/lib/actions/settings";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { formatCurrency } from "@/lib/format";

// The cushion safe-to-spend holds back below its projected low point.
// Zero is a real choice. "Use suggested" clears the stored value so the
// suggestion keeps tracking spending as it changes, rather than freezing
// today's figure in.
export function SafeToSpendCushionForm({
  amount,
  isDefault,
  suggested,
}: {
  amount: number;
  isDefault: boolean;
  suggested: number;
}) {
  const inputId = useId();
  const [state, action, pending] = useActionState<SafeToSpendCushionActionState, FormData>(
    setSafeToSpendCushionAction,
    undefined,
  );

  const hint = isDefault
    ? `Using the suggestion: ${formatCurrency(suggested)}, about a week of everyday spending from checking and savings.`
    : `Suggested: ${formatCurrency(suggested)}, about a week of everyday spending from checking and savings.`;

  return (
    <form action={action} className="mt-4 flex flex-col gap-3">
      <FormField label="Cushion" htmlFor={inputId} hint={hint} error={state?.error}>
        {/* Keyed on the saved value so "Use suggested" (or a save that
            normalises "250" to 250.00) refreshes the uncontrolled field. */}
        <Input
          key={`${amount}-${isDefault}`}
          id={inputId}
          name="cushion"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={amount.toFixed(2)}
          className="max-w-40"
        />
      </FormField>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          Save cushion
        </Button>
        {!isDefault ? (
          <button
            type="submit"
            name="reset"
            value="1"
            disabled={pending}
            className="min-h-11 rounded-full px-4 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
          >
            Use suggested
          </button>
        ) : null}
        <span aria-live="polite" className="text-sm text-ink-muted">
          {pending ? "Saving…" : state?.saved ? "Saved" : null}
        </span>
      </div>
    </form>
  );
}
