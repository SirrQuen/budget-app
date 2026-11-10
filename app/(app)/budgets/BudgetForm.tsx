"use client";

import { useEffect, useRef } from "react";
import { useActionForm } from "@/components/useActionForm";
import {
  createBudgetAction,
  setBudgetAmountAction,
  type ActionState,
} from "@/lib/actions/budgets";
import type { CategoryWithGroup } from "@/lib/db/categories";
import { FormField, useFieldId } from "@/components/ui/FormField";
import { Input, FIELD_CLASS } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { formatMonthName } from "@/lib/budgetMonth";

const fieldClassName = FIELD_CLASS;

// An existing budget: its category and month identify it and are never
// edited -- only the amount. carriedFrom is set when this month has no row
// of its own yet; saving then writes this month's row, for this category
// only (setBudgetAmountAction).
export type EditableBudget = {
  categoryid: string;
  category_name: string;
  budget_month: string;
  budget_amount: number;
  carriedFrom: string | null;
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
  const [state, action, pending, submit] = useActionForm<ActionState>(
    isEdit ? setBudgetAmountAction : createBudgetAction,
    undefined,
  );
  // The create form and any open edit row share a page -- see useFieldId.
  const fieldId = useFieldId();
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
      onSubmit={submit}
      className="flex flex-col gap-5 rounded-2xl border border-hairline bg-surface p-5"
    >
      {isEdit ? (
        <>
          <input type="hidden" name="categoryid" value={budget.categoryid} />
          <input type="hidden" name="budget_month" value={budget.budget_month} />
        </>
      ) : null}

      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">
          {isEdit ? `${budget.category_name} budget` : "New budget"}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Cancel
        </button>
      </div>

      {/* A new budget picks its category. An existing one keeps its
          category and month -- they're what identifies it -- and changes
          its amount. */}
      {isEdit ? (
        budget.carriedFrom ? (
          <p className="text-sm text-ink-secondary">
            Carried from {formatMonthName(budget.carriedFrom)}. Saving sets {formatMonthName(budget.budget_month)}
            &apos;s amount, and later months carry it from here.
          </p>
        ) : null
      ) : (
        <FormField label="Category" htmlFor={fieldId("categoryid")} required>
          <select
            id={fieldId("categoryid")}
            name="categoryid"
            required
            defaultValue=""
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
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* A new budget starts in the month being viewed and carries from
            there; the Prev/Next links choose the month. */}
        {isEdit ? null : <input type="hidden" name="budget_month" value={month} />}

        <FormField label="Budgeted amount" htmlFor={fieldId("budget_amount")} required>
          <Input
            id={fieldId("budget_amount")}
            name="budget_amount"
            type="number"
            inputMode="decimal"
            min="0"
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
