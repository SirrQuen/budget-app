"use client";

import { useState } from "react";
import { CloseIcon } from "@/components/ui/icons";

// "Since Tuesday" / "since yesterday" / "since earlier today" -- a specific
// calendar reference reads warmer than a raw duration ("since 14 hours
// ago"). Computed on the client so it lands in the viewer's own timezone.
function sinceLabel(since: Date, now: Date): string {
  const sinceDay = new Date(since.getFullYear(), since.getMonth(), since.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.round((today.getTime() - sinceDay.getTime()) / 86_400_000);

  if (dayDiff <= 0) return "earlier today";
  if (dayDiff === 1) return "yesterday";
  if (dayDiff < 7) return since.toLocaleDateString(undefined, { weekday: "long" });
  return since.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The dashboard's "since you were last here" strip. The server decides
 * whether to render it at all (only when the previous login was more than a
 * few hours ago) and hands down the already-collected facts -- at most
 * four, in a fixed order. This component only phrases the line, animates it
 * in, and lets the user dismiss it.
 */
export function ReturnSummaryStrip({ since, facts }: { since: string; facts: string[] }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || facts.length === 0) return null;

  // "now" resolves to the server's clock during SSR and the viewer's on the
  // client -- near a day boundary those can name different days, which is a
  // legitimate difference, not a bug. suppressHydrationWarning covers just
  // this text node.
  const line = `Since ${sinceLabel(new Date(since), new Date())}: ${facts.join(" · ")}`;

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-surface-raised px-4 py-3 text-sm text-ink motion-safe:animate-[celebrate-pop_700ms_ease-out]"
    >
      <span suppressHydrationWarning>{line}</span>
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
