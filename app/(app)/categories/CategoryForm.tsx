"use client";

import { useEffect, useRef } from "react";
import { useActionState } from "react";
import {
  createCategoryAction,
  updateCategoryAction,
  type ActionState,
} from "@/lib/actions/categories";
import { CATEGORY_COLOR_SWATCHES, categoryColorVar } from "@/lib/categoryOptions";
import { CATEGORY_ICON_NAMES, CategoryIcon } from "@/components/ui/CategoryIcon";
import type { CategoryWithGroup } from "@/lib/db/categories";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

// Shared by the "Add category" flow and each row's "Edit" flow -- same
// fields either way, just pre-filled and pointed at a different action when
// a category is passed in.
export function CategoryForm({
  category,
  groups,
  onSuccess,
  onCancel,
}: {
  category?: CategoryWithGroup;
  groups: { id: string; name: string }[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const isEdit = category !== undefined;
  const [state, action, pending] = useActionState<ActionState, FormData>(
    isEdit ? updateCategoryAction : createCategoryAction,
    undefined,
  );
  const wasPending = useRef(false);

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
      {isEdit ? <input type="hidden" name="id" value={category.id} /> : null}

      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">
          {isEdit ? "Edit category" : "New category"}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Cancel
        </button>
      </div>

      <FormField label="Name" htmlFor="category_name" required>
        <Input
          id="category_name"
          name="category_name"
          required
          maxLength={60}
          defaultValue={category?.category_name}
        />
      </FormField>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium text-ink-secondary">Type</legend>
        <div className="inline-flex w-fit rounded-full border border-hairline bg-surface-raised p-1">
          {(["Income", "Expense"] as const).map((value) => (
            <label
              key={value}
              className="cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink has-[:checked]:bg-surface has-[:checked]:text-ink has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-action has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-surface-raised"
            >
              <input
                type="radio"
                name="category_type"
                value={value}
                required
                defaultChecked={category?.category_type === value}
                className="sr-only"
              />
              {value}
            </label>
          ))}
        </div>
      </fieldset>

      <FormField label="Group" htmlFor="groupid" required>
        <select
          id="groupid"
          name="groupid"
          required
          defaultValue={category?.groupid ?? ""}
          className="w-full rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-action focus:ring-2 focus:ring-action/40"
        >
          <option value="" disabled>
            Select a group
          </option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </FormField>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium text-ink-secondary">Icon</legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_ICON_NAMES.map((name) => (
            <label
              key={name}
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-hairline bg-surface-raised text-ink-secondary transition-all duration-150 hover:-translate-y-0.5 hover:border-ink-muted hover:text-ink has-[:checked]:border-action has-[:checked]:bg-action/10 has-[:checked]:text-action has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-action has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-surface"
            >
              <input
                type="radio"
                name="icon"
                value={name}
                required
                defaultChecked={category?.icon === name}
                className="sr-only"
              />
              <CategoryIcon icon={name} className="h-5 w-5" />
              <span className="sr-only">{name.replace(/-/g, " ")}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium text-ink-secondary">Colour</legend>
        <p className="text-sm text-ink-muted">
          Picked from the app&rsquo;s fixed data-colour set, so it stays readable in charts.
        </p>
        <div className="flex flex-wrap gap-2">
          {/* The swatch previews the slot as it looks in the CURRENT theme,
              not as the hex it stores -- otherwise the picker shows one
              colour and the dot it produces shows another. */}
          {CATEGORY_COLOR_SWATCHES.map((swatch) => (
            <label
              key={swatch.value}
              className="h-8 w-8 cursor-pointer rounded-full ring-2 ring-transparent ring-offset-2 ring-offset-surface transition-all duration-150 hover:scale-110 has-[:checked]:ring-ink has-[:focus-visible]:ring-action"
              style={{ backgroundColor: categoryColorVar(swatch.value) }}
            >
              <input
                type="radio"
                name="color"
                value={swatch.value}
                required
                defaultChecked={category?.color === swatch.value}
                className="sr-only"
              />
              <span className="sr-only">{swatch.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {state?.error ? <ErrorMessage message={state.error} /> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : isEdit ? "Save changes" : "Add category"}
      </Button>
    </form>
  );
}
