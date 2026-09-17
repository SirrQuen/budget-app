"use client";

import { useState, useTransition } from "react";
import { CategoryForm } from "./CategoryForm";
import { archiveCategoryAction } from "@/lib/actions/categories";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { CategoryActivity, CategoryWithGroup } from "@/lib/db/categories";
import { categoryColorVar } from "@/lib/categoryOptions";
import { formatCurrency } from "@/lib/format";

export function CategoryRow({
  category,
  groups,
  activity,
}: {
  category: CategoryWithGroup;
  groups: { id: string; name: string }[];
  /** null only when the activity query itself failed -- rendered the same
   * as "never used" rather than blocking the row. */
  activity: CategoryActivity | null;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [archiveError, setArchiveError] = useState<string>();
  const [isArchiving, startArchive] = useTransition();

  function handleArchive() {
    startArchive(async () => {
      const result = await archiveCategoryAction(category.id);
      if (result?.error) {
        setArchiveError(result.error);
        return;
      }
      setConfirmingArchive(false);
    });
  }

  const lifetimeCount = activity?.lifetimeTransactionCount ?? 0;
  const neverUsed = lifetimeCount === 0;

  if (editing) {
    return (
      <li className="p-4 sm:col-span-4">
        <CategoryForm
          category={category}
          groups={groups}
          onSuccess={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li
      className={`flex flex-col gap-2 px-4 py-3 transition-colors duration-150 hover:bg-surface-raised sm:col-span-4 sm:grid sm:grid-cols-subgrid sm:items-center sm:gap-y-0 sm:px-0 sm:py-0 sm:min-h-[52px] ${category.is_active ? "" : "opacity-60"}`}
    >
      {/* Below sm the actions drop onto their own line: sm:contents
          dissolves these wrappers from sm up so their children land
          directly in the row's four subgrid columns (name, group, this
          month, actions) instead of nesting inside them -- same pattern as
          AccountRow. */}
      <div className="flex items-start justify-between gap-3 sm:contents">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:contents">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: categoryColorVar(category.color) }}
              aria-hidden="true"
            />
            <CategoryIcon icon={category.icon} className="h-4 w-4 shrink-0 text-ink-secondary" />
            <span className="min-w-0 truncate text-sm font-medium text-ink">{category.category_name}</span>
            {!category.is_active ? (
              <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-xs font-medium text-ink-muted">
                Archived
              </span>
            ) : null}
          </div>

          <span className="shrink-0 justify-self-start text-sm text-ink-secondary">
            {category.group_name}
          </span>
        </div>

        {/* "This month": the category's own direction (Expense spend /
            Income earned), never colour-coded by type -- the category
            itself already says which it is. A never-used category reads
            "Not used yet" instead of an amount so an empty column doesn't
            look broken on the 1st of the month. */}
        <span className="shrink-0 justify-self-end text-right text-sm tabular-nums">
          {neverUsed ? (
            <span className="font-normal text-ink-secondary">Not used yet</span>
          ) : (
            <span className="font-medium text-ink">
              {formatCurrency(activity?.currentMonthTotal ?? 0)}
            </span>
          )}
        </span>
      </div>
      {/* Below sm the actions drop onto their own line so "Edit" / "Archive"
          stop competing with the category name for width, and each control
          gets a 44px tap target. */}
      <div className="-mx-2 flex shrink-0 items-center gap-1 sm:col-start-4 sm:mx-0 sm:justify-self-end sm:gap-3">
        {archiveError ? <span className="px-2 text-sm text-critical sm:px-0">{archiveError}</span> : null}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex min-h-11 items-center rounded px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:px-0"
        >
          Edit
        </button>
        {category.is_active ? (
          <button
            type="button"
            onClick={() => setConfirmingArchive(true)}
            className="inline-flex min-h-11 items-center rounded px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:px-0"
          >
            Archive
          </button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmingArchive}
        title={`Archive "${category.category_name}"?`}
        description="It'll drop out of the picker for new transactions, but past transactions keep it -- your history survives. You're archiving, not deleting."
        confirmLabel={isArchiving ? "Archiving…" : "Archive"}
        cancelLabel="Cancel"
        onConfirm={handleArchive}
        onCancel={() => setConfirmingArchive(false)}
      />
    </li>
  );
}
