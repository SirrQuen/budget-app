"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  confirmIcon,
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  /** Status colour must never stand alone -- pair a critical tone with an icon here, not just the label. */
  confirmIcon?: React.ReactNode;
  cancelLabel?: string;
  tone?: "default" | "critical";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="w-full max-w-sm rounded-2xl border border-hairline bg-surface p-0 text-ink backdrop:bg-scrim"
    >
      <div className="p-5">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <p className="mt-2 text-sm text-ink-secondary">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {cancelLabel}
          </button>
          <Button
            type="button"
            variant={tone === "critical" ? "critical" : "primary"}
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5"
          >
            {confirmIcon}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
