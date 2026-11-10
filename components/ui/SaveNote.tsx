"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// How long a save note stays up. Longer than the 1.6s "Logged" pill: this
// is a sentence to read, not a tick to glance at.
const SAVE_NOTE_MS = 8000;

/**
 * A neutral sentence shown after a save, beside the "Logged" pill -- a fact
 * about the save, not a reward, so ink on a raised surface: no status
 * colour, no icon. Today's only note is figureUnchangedNote
 * (docs/Safe-to-Spend-Why.md).
 */
export function SaveNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className="max-w-sm rounded-2xl border border-hairline bg-surface-raised px-4 py-2 text-center text-sm text-ink-secondary"
    >
      {message}
    </p>
  );
}

/** The note on screen, and a function to show one (null clears it). */
export function useSaveNote(): [string | null, (message: string | null) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((next: string | null) => {
    clearTimeout(timeout.current);
    setMessage(next);
    if (next) timeout.current = setTimeout(() => setMessage(null), SAVE_NOTE_MS);
  }, []);

  useEffect(() => () => clearTimeout(timeout.current), []);

  return [message, show];
}
