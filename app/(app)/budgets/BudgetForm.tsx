"use client";

import { useEffect, useRef } from "react";
import { useActionState } from "react";
import {
  createBudgetAction,
  updateBudgetAction,
  type ActionState,
} from "@/lib/actions/budgets";
import type { CategoryWithGroup } from "@/lib/db/categories";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

const fieldClassName =
  "w-full rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-gold focus:ring-2 focus:ring-gold/40";

export type EditableBudget = {
  id: string;
  categoryid: string;
  budget_month: string;
  budget_amount: number;
};

// Groups an already type-filtered category list by its category group for
// the <select>, mirroring AddTransactionForm's picker.
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

// Shared by the "Add budget" flow and each row's "Edit" flow -- same fields
// either way, just pre-filled and pointed at a different action when a
// budget is passed in.
export function BudgetForm({
  budget,
  categories,
  month,
  onSuccess,
  onCancel,
}: {
  budget?: EditableBudget;
  categories: CategoryWithGroup[];
  /** Default month for a new budget -- the month currently being viewed. */
  month: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const isEdit = budget !== undefined;
  const [state, action, pending] = useActionState<ActionState, FormData>(
    isEdit ? updateBudgetAction : createBudgetAction,
    undefined,
  );
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) {
      onSuccess();
    }
    wasPending.current = pending;
  }, [pending, state, onSuccess]);

  const categoryGroups = groupByCategoryGroup(categories);

  return (
    <form
      action={action}
      className="flex flex-col gap-5 rounded-2xl border border-hairline bg-surface p-5"
    >
      {isEdit ? <input type="hidden" name="id" value={budget.id} /> : null}

      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">
          {isEdit ? "Edit budget" : "New budget"}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Cancel
        </button>
      </div>

      <FormField label="Category" htmlFor="categoryid" required>
        <select
          id="categoryid"
          name="categoryid"
          required
          defaultValue={budget?.categoryid ?? ""}
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
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Month" htmlFor="budget_month" required>
          <input
            id="budget_month"
            name="budget_month"
            type="month"
            required
            defaultValue={(budget?.budget_month ?? month).slice(0, 7)}
            className={fieldClassName}
          />
        </FormField>

        <FormField label="Budgeted amount" htmlFor="budget_amount" required>
          <Input
            id="budget_amount"
            name="budget_amount"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            required
            defaultValue={budget?.budget_amount}
          />
        </FormField>
      </div>

      {state?.error ? <ErrorMessage message={state.error} /> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : isEdit ? "Save changes" : "Add budget"}
      </Button>
    </form>
  );
}
