"use client";

import { useState, useTransition } from "react";
import { CategoryForm } from "./CategoryForm";
import { archiveCategoryAction } from "@/lib/actions/categories";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { CategoryWithGroup } from "@/lib/db/categories";
import { categoryColorVar } from "@/lib/categoryOptions";

export function CategoryRow({
  category,
  groups,
}: {
  category: CategoryWithGroup;
  groups: { id: string; name: string }[];
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

  if (editing) {
    return (
      <li className="p-4">
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
      className={`flex flex-col gap-2 px-4 py-3 transition-colors duration-150 hover:bg-surface-raised sm:flex-row sm:items-center sm:gap-3 ${category.is_active ? "" : "opacity-60"}`}
    >
      <div className="flex min-w-0 items-center gap-3 sm:flex-1">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: categoryColorVar(category.color) }}
          aria-hidden="true"
        />
        <CategoryIcon icon={category.icon} className="h-4 w-4 shrink-0 text-ink-secondary" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{category.category_name}</span>
        {!category.is_active ? (
          <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-xs font-medium text-ink-muted">
            Archived
          </span>
        ) : null}
      </div>
      {/* Below sm the actions drop onto their own line so "Edit" / "Archive"
          stop competing with the category name for width, and each control
          gets a 44px tap target. */}
      <div className="-mx-2 flex shrink-0 items-center gap-1 sm:mx-0 sm:gap-3">
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
