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
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { Celebration } from "@/components/ui/Celebration";

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

function todayISO() {
  // Local calendar day, not UTC -- toISOString() alone can land on
  // yesterday or tomorrow depending on the user's timezone offset.
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

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
}: {
  mode?: TransactionFormMode;
  initialValues?: TransactionInitialValues;
  incomeCategories: CategoryWithGroup[];
  expenseCategories: CategoryWithGroup[];
  accounts: TransactionAccountOption[];
}) {
  const isEdit = mode === "edit";
  const [open, setOpen] = useState(isEdit);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    isEdit ? updateTransactionAction : createTransactionAction,
    undefined,
  );
  const [type, setType] = useState<TransactionType>(initialValues?.transaction_type ?? "Expense");
  const [categoryid, setCategoryid] = useState(initialValues?.categoryid ?? "");
  const [amount, setAmount] = useState(initialValues ? String(initialValues.amount) : "");
  const [clientError, setClientError] = useState<string>();
  const [celebrate, setCelebrate] = useState(false);
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
      setCelebrate(true);
      clearTimeout(celebrateTimeout.current);
      celebrateTimeout.current = setTimeout(() => setCelebrate(false), 1600);
    }
    wasPending.current = pending;
  }, [pending, state, isEdit]);

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

  if (!isEdit && !open) {
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
              className="text-sm font-medium text-ink-secondary hover:text-ink"
            >
              Cancel
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm font-medium text-ink-secondary hover:text-ink"
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
              defaultValue={initialValues?.transaction_date ?? todayISO()}
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
            defaultValue={initialValues?.description}
          />
        </FormField>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium text-ink-secondary">Type</legend>
          <div className="inline-flex w-fit rounded-full border border-hairline bg-surface-raised p-1">
            {(["Expense", "Income"] as const).map((value) => (
              <label
                key={value}
                className="cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors has-[:checked]:bg-surface has-[:checked]:text-ink"
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
              defaultValue={initialValues?.merchant ?? undefined}
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

      {isEdit ? null : <Celebration show={celebrate} message="Logged" icon="✓" />}
    </div>
  );
}
