"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import {
  createRecurringAction,
  updateRecurringAction,
  type ActionState,
} from "@/lib/actions/recurring";
import type { CategoryWithGroup } from "@/lib/db/categories";
import type { TransactionAccountOption } from "../transactions/AddTransactionForm";
import { todayISO } from "@/lib/date";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

const fieldClassName =
  "w-full rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-action focus:ring-2 focus:ring-action/40";

// Expense/Income pick a category (filtered by this same value, same trick
// AddTransactionForm uses); Transfer swaps Category+Account for From/To
// account pickers -- no category at all, same as a transfer transaction's
// own categoryid (see CLAUDE.md "Backend contract" and 07_transfers.sql).
type Kind = "Expense" | "Income" | "Transfer";
const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: "Expense", label: "Expense" },
  { value: "Income", label: "Income" },
  { value: "Transfer", label: "Transfer" },
];

// The three cadences people actually use -- "every N weeks" folds Biweekly
// in as Weekly + interval_count rather than a frequency value of its own.
// Daily/Quarterly aren't offered here at all; see lib/actions/recurring.ts.
type Repeats = "Monthly" | "Weekly" | "Yearly";
const REPEATS_OPTIONS: { value: Repeats; label: string }[] = [
  { value: "Monthly", label: "Monthly" },
  { value: "Weekly", label: "Every few weeks" },
  { value: "Yearly", label: "Yearly" },
];

type Ends = "never" | "count" | "date";
const ENDS_OPTIONS: { value: Ends; label: string }[] = [
  { value: "never", label: "Never" },
  { value: "count", label: "After" },
  { value: "date", label: "On" },
];

// Maps a stored (frequency, interval_count) back onto the picker's three
// cadences -- only matters for opening the edit form on a schedule already
// on file. Biweekly (the pre-picker equivalent of "every 2 weeks") lands on
// Weekly with interval 2; a hypothetical Daily/Quarterly row -- the picker
// never writes either, so this is purely defensive -- lands on Monthly
// rather than an unselected control.
function repeatsFromFrequency(frequency: string): Repeats {
  if (frequency === "Weekly" || frequency === "Biweekly") return "Weekly";
  if (frequency === "Yearly") return "Yearly";
  return "Monthly";
}

function intervalFromFrequency(frequency: string, storedIntervalCount: number): number {
  return frequency === "Biweekly" ? 2 : storedIntervalCount;
}

function endsFromRecord(occurrenceLimit: number | null, endDate: string | null): Ends {
  if (occurrenceLimit !== null) return "count";
  if (endDate !== null) return "date";
  return "never";
}

export type EditableRecurring = {
  id: string;
  description: string;
  amount: number;
  kind: Kind;
  categoryid: string | null;
  accountid: string;
  to_accountid: string | null;
  frequency: string;
  interval_count: number;
  next_run_date: string;
  occurrence_limit: number | null;
  end_date: string | null;
  amount_is_variable: boolean;
  statement_day: number | null;
};

// Seeds a fresh (create-mode) schedule from something that already carries
// this data -- currently just an existing transaction ("Make this
// recurring"). Unlike EditableRecurring, deliberately carries no schedule
// fields: a one-off transaction implies no cadence, so Repeats/Next due
// date/Ends all start from this form's normal create-mode defaults instead.
export type RecurringPrefill = {
  description: string;
  amount: number;
  kind: Kind;
  categoryid: string | null;
  accountid: string;
  to_accountid: string | null;
};

// Groups an already type-filtered category list by its category group for
// the <select>, same shape AddTransactionForm/BudgetForm use.
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

// The Type, Repeats and Ends pickers are all the same shape: a pill row
// where one choice is selected, the rest just for switching. Typed on the
// option value so a caller's onChange never needs a cast.
function SegmentedControl<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex w-fit flex-wrap gap-1 rounded-full border border-hairline bg-surface-raised p-1">
      {options.map((opt) => (
        <label
          key={opt.value}
          className="cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink has-[:checked]:bg-surface has-[:checked]:text-ink has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-action has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-surface-raised"
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className="sr-only"
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

// Shared by the "Add schedule" flow, each row's "Edit" flow, and "Make this
// recurring" on an existing transaction (prefill). A category schedule
// stores no transaction_type of its own -- Kind here only picks which
// category list to show (same trick as AddTransactionForm); the type the
// user ends up with is whatever the chosen category carries, and the
// enforce_category_type trigger checks it exactly like it does for a normal
// transaction once an occurrence actually posts. Kind "Transfer" instead
// posts the same two-leg shape a manual transfer does (see
// lib/db/recurring.ts's generateDueOccurrences) -- no category at all.
export function RecurringForm({
  recurring,
  prefill,
  incomeCategories,
  expenseCategories,
  accounts,
  onSuccess,
  onCancel,
}: {
  recurring?: EditableRecurring;
  /** Create mode only -- seeds fields from an existing transaction. Ignored if `recurring` is set. */
  prefill?: RecurringPrefill;
  incomeCategories: CategoryWithGroup[];
  expenseCategories: CategoryWithGroup[];
  accounts: TransactionAccountOption[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const isEdit = recurring !== undefined;
  const seed = recurring ?? prefill;
  const [state, action, pending] = useActionState<ActionState, FormData>(
    isEdit ? updateRecurringAction : createRecurringAction,
    undefined,
  );
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) {
      onSuccess();
    }
    wasPending.current = pending;
  }, [pending, state, onSuccess]);

  const initialKind: Kind = seed?.kind ?? "Expense";
  const [kind, setKind] = useState<Kind>(initialKind);
  // Mirrors TransferAccountFields' own "to account" selection so this form
  // can decide whether the destination is a Credit Card -- the only case
  // "Amount changes each month" is offered. Not the source of truth for
  // submission (TransferAccountFields still owns and submits its own
  // <select>); this is purely for showing/hiding the toggle below it.
  const [toAccountId, setToAccountId] = useState<string>(
    kind === initialKind ? (seed?.to_accountid ?? "") : "",
  );
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const toAccountIsCreditCard = toAccount?.account_type === "Credit Card";
  const [amountIsVariable, setAmountIsVariable] = useState(recurring?.amount_is_variable ?? false);
  const showVariableToggle = kind === "Transfer" && toAccountIsCreditCard;
  const showVariableFields = showVariableToggle && amountIsVariable;
  const [repeats, setRepeats] = useState<Repeats>(
    recurring ? repeatsFromFrequency(recurring.frequency) : "Monthly",
  );
  const [ends, setEnds] = useState<Ends>(
    recurring ? endsFromRecord(recurring.occurrence_limit, recurring.end_date) : "never",
  );
  const initialIntervalCount = recurring
    ? intervalFromFrequency(recurring.frequency, recurring.interval_count)
    : 1;

  const scheduleHint =
    repeats === "Monthly"
      ? "Posts on this day each month -- on the last day instead when a month is shorter (day 31 becomes Feb 28)."
      : repeats === "Weekly"
        ? "Sets which weekday it repeats on."
        : "Sets the month and day it repeats on.";

  const categoryGroups = groupByCategoryGroup(kind === "Income" ? incomeCategories : expenseCategories);

  return (
    <form
      action={action}
      className="flex flex-col gap-5 rounded-2xl border border-hairline bg-surface p-5"
    >
      {isEdit ? <input type="hidden" name="id" value={recurring.id} /> : null}

      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">
          {isEdit ? "Edit schedule" : "New schedule"}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Description" htmlFor="description" required>
          <Input
            id="description"
            name="description"
            required
            maxLength={120}
            placeholder="e.g. Rent"
            defaultValue={seed?.description}
          />
        </FormField>

        {showVariableFields ? (
          <FormField
            label="Statement day"
            htmlFor="statement_day"
            required
            hint="EverNest asks for the amount once the statement posts on this day each month, and estimates from the card's current balance until then."
          >
            <Input
              id="statement_day"
              name="statement_day"
              type="number"
              inputMode="numeric"
              min="1"
              max="31"
              required
              defaultValue={recurring?.statement_day ?? undefined}
            />
          </FormField>
        ) : (
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
              defaultValue={seed?.amount}
            />
          </FormField>
        )}
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium text-ink-secondary">Type</legend>
        <SegmentedControl name="kind" value={kind} onChange={setKind} options={KIND_OPTIONS} />
      </fieldset>

      {kind === "Transfer" ? (
        <>
          <TransferAccountFields
            accounts={accounts}
            initialFromAccountId={kind === initialKind ? (seed?.accountid ?? "") : ""}
            initialToAccountId={kind === initialKind ? (seed?.to_accountid ?? "") : ""}
            onToAccountChange={setToAccountId}
          />

          {showVariableToggle ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-secondary">
              <input
                type="checkbox"
                name="amount_is_variable"
                checked={amountIsVariable}
                onChange={(e) => setAmountIsVariable(e.target.checked)}
                className="h-4 w-4 rounded border-hairline text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
              />
              Amount changes each month
            </label>
          ) : null}
        </>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Category" htmlFor="categoryid" required>
            <select
              id="categoryid"
              name="categoryid"
              required
              // Remounts on kind change (key={kind}) so switching Expense/
              // Income/Transfer starts from an unselected list rather than
              // carrying over a categoryid that belongs to another list --
              // the previous kind's selection has no meaning for this one,
              // same as AddTransactionForm's handleTypeChange clearing it.
              defaultValue={kind === initialKind ? (seed?.categoryid ?? "") : ""}
              key={kind}
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
              defaultValue={kind === initialKind ? (seed?.accountid ?? "") : ""}
              key={kind}
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
      )}

      <div className="flex flex-col gap-4 rounded-xl border border-hairline p-4">
        <div className="flex flex-wrap items-end gap-4">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium text-ink-secondary">Repeats</legend>
            <SegmentedControl name="frequency" value={repeats} onChange={setRepeats} options={REPEATS_OPTIONS} />
          </fieldset>

          {repeats === "Weekly" ? (
            <FormField label="Every" htmlFor="interval_count">
              <div className="flex items-center gap-2">
                <Input
                  id="interval_count"
                  name="interval_count"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="52"
                  required
                  defaultValue={initialIntervalCount}
                  className="w-20"
                />
                <span className="text-sm text-ink-secondary">week(s)</span>
              </div>
            </FormField>
          ) : null}
        </div>

        <FormField label="Next due date" htmlFor="next_run_date" required hint={scheduleHint}>
          <input
            id="next_run_date"
            name="next_run_date"
            type="date"
            required
            defaultValue={recurring?.next_run_date ?? todayISO()}
            className={fieldClassName}
          />
        </FormField>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-hairline p-4">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium text-ink-secondary">Ends</legend>
          <SegmentedControl name="ends" value={ends} onChange={setEnds} options={ENDS_OPTIONS} />
        </fieldset>

        {ends === "count" ? (
          <FormField label="Occurrences" htmlFor="occurrence_count" hint="How many times this posts before it stops.">
            <Input
              id="occurrence_count"
              name="occurrence_count"
              type="number"
              inputMode="numeric"
              min="1"
              required
              defaultValue={recurring?.occurrence_limit ?? undefined}
              className="w-24"
            />
          </FormField>
        ) : null}

        {ends === "date" ? (
          <FormField label="End date" htmlFor="end_date">
            <input
              id="end_date"
              name="end_date"
              type="date"
              required
              defaultValue={recurring?.end_date ?? ""}
              className={fieldClassName}
            />
          </FormField>
        ) : null}
      </div>

      {state?.error ? <ErrorMessage message={state.error} /> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : isEdit ? "Save changes" : "Add schedule"}
      </Button>
    </form>
  );
}

// Split out only so the From/To mismatch check can own its own state
// without dragging useState into the parent -- mirrors AddTransactionForm's
// Transfer mode exactly (the same "choose two different accounts" rule,
// checked inline rather than round-tripping to the server for it).
function TransferAccountFields({
  accounts,
  initialFromAccountId,
  initialToAccountId,
  onToAccountChange,
}: {
  accounts: TransactionAccountOption[];
  initialFromAccountId: string;
  initialToAccountId: string;
  /** Mirrors the selection up to RecurringForm, which needs it to know whether the destination is a Credit Card. */
  onToAccountChange: (accountId: string) => void;
}) {
  const [fromAccountId, setFromAccountId] = useState(initialFromAccountId);
  const [toAccountId, setToAccountId] = useState(initialToAccountId);
  const mismatch = fromAccountId !== "" && fromAccountId === toAccountId;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField label="From account" htmlFor="accountid" required>
        <select
          id="accountid"
          name="accountid"
          required
          value={fromAccountId}
          onChange={(e) => setFromAccountId(e.target.value)}
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

      <FormField
        label="To account"
        htmlFor="to_accountid"
        required
        error={mismatch ? "From and to accounts must be different." : undefined}
      >
        <select
          id="to_accountid"
          name="to_accountid"
          required
          value={toAccountId}
          onChange={(e) => {
            setToAccountId(e.target.value);
            onToAccountChange(e.target.value);
          }}
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
  );
}
