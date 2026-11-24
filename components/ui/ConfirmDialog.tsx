"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  confirmIcon,
  cancelLabel = "Cancel",
  tone = "default",
  busy = false,
  returnFocus,
  secondaryLabel,
  onSecondary,
  secondaryDisabled = false,
  children,
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
  /**
   * The confirmed action is running: both buttons and Esc do nothing, so a
   * second press can't fire it twice.
   */
  busy?: boolean;
  /**
   * Where focus goes when the dialog closes. By default the browser returns
   * it to the trigger -- give this when the action removes the trigger (a
   * deleted row), or focus falls to <body>.
   */
  returnFocus?: () => HTMLElement | null;
  /**
   * A gentler alternative to the confirmed action, offered beside it
   * ("Separate them instead"). Neutral, never the critical tone.
   */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** The secondary action is waiting on an answer in `children` (aria-disabled, so focus stays). */
  secondaryDisabled?: boolean;
  /** A control the secondary action needs, under the description. */
  children?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  // Read at close time, so a caller's inline function is never stale.
  // Updated in a layout effect, which runs before the effects below.
  const returnFocusRef = useRef(returnFocus);
  const openRef = useRef(open);
  useLayoutEffect(() => {
    returnFocusRef.current = returnFocus;
    openRef.current = open;
  });

  // The action can remove this dialog's own row in the same commit that
  // would have closed it -- unmounted while open, it never runs close()
  // below, and focus falls to <body>. Send it on from here instead.
  useEffect(
    () => () => {
      if (openRef.current) returnFocusRef.current?.()?.focus();
    },
    [],
  );

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) {
      // close() restores focus to the trigger synchronously; override it
      // after, when the caller has named somewhere that will survive.
      dialog.close();
      returnFocusRef.current?.()?.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descId}
      aria-busy={busy || undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
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
        {children ? <div className="mt-3">{children}</div> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {/* aria-disabled, not disabled, while busy: disabling the focused
              button would drop focus out of the dialog mid-action. */}
          <button
            type="button"
            onClick={() => {
              if (!busy) onCancel();
            }}
            aria-disabled={busy || undefined}
            className="min-h-11 rounded-full px-4 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          {secondaryLabel && onSecondary ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (!busy && !secondaryDisabled) onSecondary();
              }}
              aria-disabled={busy || secondaryDisabled || undefined}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              {secondaryLabel}
            </Button>
          ) : null}
          <Button
            type="button"
            variant={tone === "critical" ? "critical" : "primary"}
            onClick={() => {
              if (!busy) onConfirm();
            }}
            aria-disabled={busy || undefined}
            className="inline-flex items-center gap-1.5 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:translate-y-0 aria-disabled:hover:shadow-none"
          >
            {confirmIcon}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
