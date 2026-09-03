"use client";

import { useEffect, useId, useRef } from "react";
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
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      // A definite width already inside the viewport (rather than w-full +
      // max-width): Chrome resolves width:100% before the max-width clamp and
      // drops the auto margins to 0, pinning the modal to the top-left. This
      // keeps a 1rem gutter and stays centred by the dialog UA margin:auto.
      className="mx-auto my-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-hairline bg-surface p-0 text-ink backdrop:bg-scrim"
    >
      <div className="p-5">
        <h2 id={titleId} className="text-base font-semibold text-ink">
          {title}
        </h2>
        <p id={descId} className="mt-2 text-sm text-ink-secondary">
          {description}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-full px-4 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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
