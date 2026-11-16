"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedSummary } from "@/lib/savedSummary";
import { DrawnCheck } from "@/components/ui/DrawnCheck";
import { LeafIcon } from "@/components/ui/LeafIcon";
import { useReducedMotion } from "@/components/ui/useReducedMotion";

// After a successful create (docs/Motion-and-Delight.md, step 3):
//   - the Save button briefly says "Saved" with a check (SavedLabel);
//   - one or two gold leaves float up from it and fade (SaveLeaves);
//   - this toast: "Logged · Coffee $5.75", with Log again, and a small
//     "First one today" chip on the first save of a day.
// The same reaction for every amount. No streaks, no counts, nothing about
// yesterday. Under reduced motion the toast simply appears and no leaves fly.

const TOAST_MS = 6000;

/** The toast on screen, and a function to show one (null clears it). */
export function useSaveToast(): [SavedSummary | null, (summary: SavedSummary | null) => void] {
  const [summary, setSummary] = useState<SavedSummary | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((next: SavedSummary | null) => {
    clearTimeout(timeout.current);
    setSummary(next);
    if (next) timeout.current = setTimeout(() => setSummary(null), TOAST_MS);
  }, []);
  useEffect(() => () => clearTimeout(timeout.current), []);
  return [summary, show];
}

export function SaveToast({
  summary,
  onLogAgain,
}: {
  summary: SavedSummary | null;
  /** Refills the add form from what was just logged. */
  onLogAgain: (summary: SavedSummary) => void;
}) {
  if (!summary) return null;
  return (
    <div
      role="status"
      className="toast-in pointer-events-auto flex max-w-md flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl border border-hairline bg-surface-raised px-4 py-2 text-sm text-ink shadow-lg"
    >
      <span className="flex items-center gap-2">
        <span className="text-ink-secondary" aria-hidden="true">
          <DrawnCheck />
        </span>
        <span>{summary.message}</span>
      </span>
      {summary.firstToday ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-hairline px-2 py-0.5 text-xs text-ink-secondary">
          <LeafIcon className="h-3 w-3 text-gold" />
          First one today
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => onLogAgain(summary)}
        className="min-h-9 rounded px-1 font-medium text-action underline-offset-2 hover:text-action-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
      >
        Log again
      </button>
    </div>
  );
}

/**
 * One or two leaves that float up from the Save button. Place inside a
 * `relative` wrapper around the button; `seq` changes per save, restarting
 * them. Not rendered under reduced motion.
 */
export function SaveLeaves({ seq }: { seq: number }) {
  const reduced = useReducedMotion();
  if (reduced || seq === 0) return null;
  return (
    <span key={seq} className="pointer-events-none absolute inset-x-0 top-0" aria-hidden="true">
      <LeafIcon className="save-leaf save-leaf--1" />
      <LeafIcon className="save-leaf save-leaf--2" />
    </span>
  );
}

/** The Save button's label for the moment after a save: a check and "Saved". */
export function SavedLabel() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <DrawnCheck />
      Saved
    </span>
  );
}
