"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewUndoImportAction, undoImportAction } from "@/lib/actions/import";
import type { UndoPreview } from "@/lib/db/imports";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TrashIcon } from "@/components/ui/icons";

// "Undo this import": one atomic undo (migration 68, undo_import). The
// confirmation says what it will do before it does it -- how many rows go,
// how many were edited since, and what happens to a schedule an imported
// row was matched to (item 4's delete handling, said the same way). Only
// the confirm button is red: it's destructive and irreversible.

export function UndoImportButton({
  importId,
  label = "Undo this import",
  onUndone,
  className = "inline-flex min-h-11 items-center rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
}: {
  importId: string;
  label?: string;
  onUndone?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<UndoPreview | null>(null);
  const [error, setError] = useState<string>();
  const [asking, startAsk] = useTransition();
  const [undoing, startUndo] = useTransition();

  function ask() {
    setError(undefined);
    startAsk(async () => {
      const res = await previewUndoImportAction(importId);
      if (res.error !== undefined) setError(res.error);
      else setPreview(res.data);
    });
  }

  function confirm() {
    startUndo(async () => {
      const res = await undoImportAction(importId);
      if (res.error !== undefined) {
        setError(res.error);
        setPreview(null);
        return;
      }
      setPreview(null);
      onUndone?.();
      router.refresh();
    });
  }

  const description = preview
    ? [
        preview.remaining === 0
          ? "Nothing from this import is left, so this only removes it from your list."
          : `${preview.remaining.toLocaleString("en-US")} ${preview.remaining === 1 ? "transaction" : "transactions"} will be removed, and your balances go back to how they were before it.`,
        preview.edited > 0
          ? `${preview.edited} of ${preview.edited === 1 ? "them has" : "them have"} been edited since the import. ${preview.edited === 1 ? "It" : "They"}'ll be removed too.`
          : "",
        ...preview.scheduleNotes,
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  return (
    <>
      <button type="button" onClick={ask} disabled={asking || undoing} className={className}>
        {asking ? "One moment…" : label}
      </button>
      {error ? (
        <span role="alert" className="ml-2 text-sm text-critical">
          {error}
        </span>
      ) : null}
      <ConfirmDialog
        open={preview !== null}
        title="Undo this import?"
        description={description}
        confirmLabel="Undo this import"
        confirmIcon={<TrashIcon className="h-4 w-4" aria-hidden="true" />}
        tone="critical"
        busy={undoing}
        onConfirm={confirm}
        onCancel={() => setPreview(null)}
      />
    </>
  );
}
