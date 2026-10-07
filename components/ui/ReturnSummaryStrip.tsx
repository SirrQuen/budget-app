"use client";

import { useState } from "react";
import { CloseIcon } from "@/components/ui/icons";

/**
 * The dashboard's "since you were last here" strip. The server decides
 * whether to render it at all (only when the previous login was more than a
 * few hours ago) and hands down the already-collected facts -- at most
 * four, in a fixed order -- plus the "since" phrase, built in the user's
 * timezone by lib/sinceLabel.ts. This component only joins the line,
 * animates it in, and lets the user dismiss it.
 */
export function ReturnSummaryStrip({ since, facts }: { since: string; facts: string[] }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || facts.length === 0) return null;

  const line = `Since ${since}: ${facts.join(" · ")}`;

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-surface-raised px-4 py-3 text-sm text-ink motion-safe:animate-[celebrate-pop_700ms_ease-out]"
    >
      <span>{line}</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 text-ink-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
      >
        <CloseIcon className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
