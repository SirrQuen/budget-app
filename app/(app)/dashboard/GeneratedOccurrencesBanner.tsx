"use client";

import { useState } from "react";
import { CloseIcon } from "@/components/ui/icons";

// The dashboard's lazy catch-up (see page.tsx and CLAUDE.md "Recurring
// transactions") can post several transactions and move the balance before
// this page even renders -- this is what makes that visible instead of a
// number that just quietly changed. Same shape as ReturnSummaryStrip: the
// server decides whether there's anything to say, this only phrases and
// dismisses it.
export function GeneratedOccurrencesBanner({ descriptions }: { descriptions: string[] }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || descriptions.length === 0) return null;

  const count = descriptions.length;
  const noun = count === 1 ? "transaction" : "transactions";
  // Names what was added when there's few enough to read at a glance --
  // "$240 toward Japan," not "great job," applies here too. Past a few, the
  // count alone says it without the line running long.
  const detail = count <= 3 ? ` (${descriptions.join(", ")})` : "";

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-surface-raised px-4 py-3 text-sm text-ink motion-safe:animate-[celebrate-pop_700ms_ease-out]"
    >
      <span>
        We added {count} {noun} from your schedules while you were away{detail}.
      </span>
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
