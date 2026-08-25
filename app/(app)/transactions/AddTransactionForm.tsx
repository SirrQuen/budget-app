"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  createTransactionAction,
  updateTransactionAction,
  type ActionState,
} from "@/lib/actions/transactions";
import type { CategoryWithGroup } from "@/lib/db/categories";
import type { TransactionType } from "@/lib/db/transactions";
import { todayISO } from "@/lib/date";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { Celebration } from "@/components/ui/Celebration";
import { FlameIcon } from "@/components/ui/icons";

const fieldClassName =
  "w-full rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-gold focus:ring-2 focus:ring-gold/40";

// Minimal shape the account picker needs -- AccountRow/AccountBalanceRow
// both satisfy this structurally, so callers can pass either straight
// through with no mapping.
export type TransactionAccountOption = {
  id: string;
  account_name: string;
  is_active: boolean;
};

export type TransactionFormMode = "create" | "edit";

// Seeds the create-mode fields from a quick-add parse instead of blank
// defaults -- only meaningful when mode is "create" (edit mode always seeds
// from initialValues).
export type AddTransactionPrefill = {
  transaction_date?: string;
  description?: string;
  amount?: string;
  merchant?: string;
};

export type TransactionInitialValues = {
  id: string;
  transaction_date: string;
  description: string;
  amount: number;
  transaction_type: TransactionType;
  categoryid: string;
  accountid: string;
  merchant: string | null;
  notes: string | null;
  payment_method: string | null;
};

// Groups an already type-filtered category list by its category group for
// the <select>, preserving the order listCategoriesForType returned (group
// sort_order, then name).
function groupByCategoryGroup(categories: CategoryWithGroup[]) {
  const groups: { name: string; categories: CategoryWithGroup[] }[] = [];
  for (const category of categories) {
    const groupName = category.group_name ?? "Other";
    let group = groups.find((g) => g.name === groupName);
    if (!group) {
      group = { name: groupName, categories: [] };
      groups.push(group);
    }
    group.categories.push(category);
  }
  return groups;
}

// Shared by the "Add transaction" flow and the dedicated edit page -- same
// fields either way, just pre-filled and pointed at a different action when
// initialValues is passed. incomeCategories/expenseCategories/accounts may
// each include one inactive (archived) entry beyond the normal active set:
// the transaction's *current* category/account, so editing an old row never
// silently reassigns it just because the picker only lists active ones.
export function AddTransactionForm({
  mode = "create",
  initialValues,
  incomeCategories,
  expenseCategories,
  accounts,
  prefill,
  embedded = false,
  onClose,
  onSaved,
}: {
  mode?: TransactionFormMode;
  initialValues?: TransactionInitialValues;
  incomeCategories: CategoryWithGroup[];
  expenseCategories: CategoryWithGroup[];
  accounts: TransactionAccountOption[];
  /** Create mode only -- seeds fields from a quick-add parse. */
  prefill?: AddTransactionPrefill;
  /** Always renders the full form, skipping the collapsed "Add transaction"
   * button -- for mounting inside an overlay that's already the toggle. */
  embedded?: boolean;
  /** Embedded mode only: called instead of collapsing when Close is clicked. */
  onClose?: () => void;
  /** Embedded mode only: called once the create-success celebration finishes. */
  onSaved?: () => void;
}) {
  const isEdit = mode === "edit";
  const [open, setOpen] = useState(isEdit || embedded);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    isEdit ? updateTransactionAction : createTransactionAction,
    undefined,
  );
  const [type, setType] = useState<TransactionType>(initialValues?.transaction_type ?? "Expense");
  const [categoryid, setCategoryid] = useState(initialValues?.categoryid ?? "");
  const [amount, setAmount] = useState(
    initialValues ? String(initialValues.amount) : (prefill?.amount ?? ""),
  );
  const [clientError, setClientError] = useState<string>();
  const [celebrate, setCelebrate] = useState(false);
  const [celebrateMessage, setCelebrateMessage] = useState("Logged");
  const [celebrateIcon, setCelebrateIcon] = useState<React.ReactNode>("✓");
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);
  const celebrateTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const categoryGroups = groupByCategoryGroup(type === "Income" ? incomeCategories : expenseCategories);

  // Success is "was pending, now isn't, and the server didn't hand back an
  // error" -- create-only. An edit's success redirects server side (see
  // updateTransactionAction), so this component won't even be on screen
  // long enough for a stay-open reset to matter.
  useEffect(() => {
    if (!isEdit && wasPending.current && !pending && !state?.error) {
      formRef.current?.reset();
      setType("Expense");
      setCategoryid("");
      setAmount("");
      setClientError(undefined);
      const milestone = state?.milestone;
      setCelebrateMessage(milestone?.message ?? "Logged");
      setCelebrateIcon(milestone?.kind === "streak-7" ? <FlameIcon className="h-4 w-4" /> : "✓");
      setCelebrate(true);
      clearTimeout(celebrateTimeout.current);
      celebrateTimeout.current = setTimeout(() => {
        setCelebrate(false);
        onSaved?.();
      }, 1600);
    }
    wasPending.current = pending;
  }, [pending, state, isEdit, onSaved]);

  useEffect(() => {
    return () => clearTimeout(celebrateTimeout.current);
  }, []);

  function handleTypeChange(next: TransactionType) {
    setType(next);
    // The previous type's category id has no meaning for the new type's
    // list -- clearing it is what keeps a mismatched pair unreachable,
    // rather than leaving a stale selection the picker no longer shows.
    setCategoryid("");
  }

  function handleAmountKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "-") {
      e.preventDefault();
    }
  }

  function handleAmountPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    if (pasted.includes("-")) {
      e.preventDefault();
      setAmount((current) => current + pasted.replace(/-/g, ""));
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const amountValue = Number(amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      e.preventDefault();
      setClientError("Enter an amount greater than zero.");
      return;
    }
    setClientError(undefined);
  }

  if (!isEdit && !embedded && !open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} className="self-start">
        Add transaction
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        ref={formRef}
        action={formAction}
        onSubmit={handleSubmit}
        className="flex flex-col gap-5 rounded-2xl border border-hairline bg-surface p-5"
      >
        {isEdit && initialValues ? (
          <input type="hidden" name="id" value={initialValues.id} />
        ) : null}

        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">
            {isEdit ? "Edit transaction" : "Add transaction"}
          </h2>
          {isEdit ? (
            <Link
              href="/transactions"
              className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Cancel
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => (embedded ? onClose?.() : setOpen(false))}
              className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Close
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Date" htmlFor="transaction_date" required>
            <input
              id="transaction_date"
              name="transaction_date"
              type="date"
              required
              defaultValue={initialValues?.transaction_date ?? prefill?.transaction_date ?? todayISO()}
              className={fieldClassName}
            />
          </FormField>

          <FormField label="Amount" htmlFor="amount" required>
            <Input
              id="amount"
              name="amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={handleAmountKeyDown}
              onPaste={handleAmountPaste}
            />
          </FormField>
        </div>

        <FormField label="Description" htmlFor="description" required>
          <Input
            id="description"
            name="description"
            required
            maxLength={120}
            placeholder="e.g. Groceries"
            defaultValue={initialValues?.description ?? prefill?.description}
          />
        </FormField>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium text-ink-secondary">Type</legend>
          <div className="inline-flex w-fit rounded-full border border-hairline bg-surface-raised p-1">
            {(["Expense", "Income"] as const).map((value) => (
              <label
                key={value}
                className="cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink has-[:checked]:bg-surface has-[:checked]:text-ink has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-surface-raised"
              >
                <input
                  type="radio"
                  name="transaction_type"
                  value={value}
                  checked={type === value}
                  onChange={() => handleTypeChange(value)}
                  className="sr-only"
                />
                {value}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Category" htmlFor="categoryid" required>
            <select
              id="categoryid"
              name="categoryid"
              required
              value={categoryid}
              onChange={(e) => setCategoryid(e.target.value)}
              className={fieldClassName}
            >
              <option value="" disabled>
                Select a category
              </option>
              {categoryGroups.map((group) => (
                <optgroup key={group.name} label={group.name}>
                  {group.categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.category_name}
                      {category.is_active ? "" : " (archived)"}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </FormField>

          <FormField label="Account" htmlFor="accountid" required>
            <select
              id="accountid"
              name="accountid"
              required
              defaultValue={initialValues?.accountid ?? ""}
              className={fieldClassName}
            >
              <option value="" disabled>
                Select an account
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.account_name}
                  {account.is_active ? "" : " (archived)"}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Merchant" htmlFor="merchant" hint="Optional">
            <Input
              id="merchant"
              name="merchant"
              maxLength={80}
              placeholder="e.g. Trader Joe's"
              defaultValue={initialValues?.merchant ?? prefill?.merchant}
            />
          </FormField>

          <FormField label="Payment method" htmlFor="payment_method" hint="Optional">
            <Input
              id="payment_method"
              name="payment_method"
              maxLength={40}
              placeholder="e.g. Debit card"
              defaultValue={initialValues?.payment_method ?? undefined}
            />
          </FormField>
        </div>

        <FormField label="Notes" htmlFor="notes" hint="Optional">
          <textarea
            id="notes"
            name="notes"
            rows={2}
            maxLength={500}
            defaultValue={initialValues?.notes ?? undefined}
            className={fieldClassName}
          />
        </FormField>

        {clientError || state?.error ? <ErrorMessage message={clientError ?? state!.error!} /> : null}

        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Saving…" : isEdit ? "Save changes" : "Add transaction"}
        </Button>
      </form>

      {isEdit ? null : (
        <Celebration show={celebrate} message={celebrateMessage} icon={celebrateIcon} />
      )}
    </div>
  );
}
