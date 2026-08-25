"use client";

import { useState, useTransition } from "react";
import { CategoryForm } from "./CategoryForm";
import { archiveCategoryAction } from "@/lib/actions/categories";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { CategoryWithGroup } from "@/lib/db/categories";

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
      className={`flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-surface-raised ${category.is_active ? "" : "opacity-60"}`}
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: category.color ?? "var(--color-ink-muted)" }}
        aria-hidden="true"
      />
      <CategoryIcon icon={category.icon} className="h-4 w-4 shrink-0 text-ink-secondary" />
      <span className="flex-1 text-sm font-medium text-ink">{category.category_name}</span>
      {!category.is_active ? (
        <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-xs font-medium text-ink-muted">
          Archived
        </span>
      ) : null}
      {archiveError ? <span className="shrink-0 text-sm text-critical">{archiveError}</span> : null}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="shrink-0 rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        Edit
      </button>
      {category.is_active ? (
        <button
          type="button"
          onClick={() => setConfirmingArchive(true)}
          className="shrink-0 rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Archive
        </button>
      ) : null}

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
