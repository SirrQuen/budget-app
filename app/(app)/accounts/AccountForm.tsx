"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import {
  createAccountAction,
  updateAccountAction,
  type ActionState,
} from "@/lib/actions/accounts";
import { ACCOUNT_TYPES, isLiabilityAccountType } from "@/lib/accountOptions";
import type { Database } from "@/lib/database.types";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

type AccountBalanceRow = Database["public"]["Views"]["v_account_balances"]["Row"];

// Shared by the "Add account" flow and each row's "Edit" flow -- same
// fields either way, just pre-filled and pointed at a different action when
// an account is passed in.
export function AccountForm({
  account,
  onSuccess,
  onCancel,
}: {
  account?: AccountBalanceRow;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const isEdit = account !== undefined;
  const [state, action, pending] = useActionState<ActionState, FormData>(
    isEdit ? updateAccountAction : createAccountAction,
    undefined,
  );
  const wasPending = useRef(false);
  const [accountType, setAccountType] = useState(account?.account_type ?? "");
  const isLiability = isLiabilityAccountType(accountType);
  // The stored opening_balance is already negative for a liability -- the
  // field always shows what the user owes as a positive number, so the
  // initial value (fixed to the account's type as loaded, not the live
  // select) needs to be un-negated once here.
  const initialOpeningBalance =
    account?.opening_balance != null && isLiabilityAccountType(account.account_type ?? "")
      ? Math.abs(account.opening_balance)
      : (account?.opening_balance ?? undefined);

  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) {
      onSuccess();
    }
    wasPending.current = pending;
  }, [pending, state, onSuccess]);

  return (
    <form
      action={action}
      className="flex flex-col gap-5 rounded-2xl border border-hairline bg-surface p-5"
    >
      {isEdit ? <input type="hidden" name="id" value={account.account_id ?? ""} /> : null}

      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">
          {isEdit ? "Edit account" : "New account"}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-ink-secondary hover:text-ink"
        >
          Cancel
        </button>
      </div>

      <FormField label="Name" htmlFor="account_name" required>
        <Input
          id="account_name"
          name="account_name"
          required
          maxLength={60}
          placeholder="e.g. Everyday Checking"
          defaultValue={account?.account_name ?? undefined}
        />
      </FormField>

      <FormField label="Type" htmlFor="account_type" required>
        <select
          id="account_type"
          name="account_type"
          required
          value={accountType}
          onChange={(e) => setAccountType(e.target.value)}
          className="w-full rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-gold focus:ring-2 focus:ring-gold/40"
        >
          <option value="" disabled>
            Select a type
          </option>
          {ACCOUNT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Institution" htmlFor="institution" hint="Optional">
        <Input
          id="institution"
          name="institution"
          maxLength={60}
          placeholder="e.g. Chase"
          defaultValue={account?.institution ?? undefined}
        />
      </FormField>

      <FormField
        label={isLiability ? "How much do you currently owe?" : "Starting balance"}
        htmlFor="opening_balance"
        hint={
          isEdit
            ? "Changing this shifts every balance calculated from it."
            : isLiability
              ? "Enter a positive number -- we'll track it as debt from here."
              : "What this account holds right now. You can enter 0 and log transactions from here."
        }
      >
        <Input
          id="opening_balance"
          name="opening_balance"
          type="number"
          step="0.01"
          min={isLiability ? 0 : undefined}
          inputMode="decimal"
          placeholder="0.00"
          defaultValue={initialOpeningBalance}
        />
      </FormField>

      {state?.error ? <ErrorMessage message={state.error} /> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : isEdit ? "Save changes" : "Add account"}
      </Button>
    </form>
  );
}
