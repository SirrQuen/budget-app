"use client";

import { useId, useState } from "react";
import { BillsPrompt, type BillsFormLists } from "./BillsPrompt";
import { billsCardDismissCookie } from "@/lib/billsCardDismiss";

// The bills card (docs/Decide-and-Grow.md, G, addition): for someone who
// tapped "Later" at step 3. Whether it shows is derived on the server
// (lib/billsPrompt.ts, billsCardVisible): fewer than three recurring
// expenses, within 14 days of the first account, new since it shipped, not
// dismissed. No badge, no notification, neutral ink.
//
// Adding a bill here is the recurring form's ordinary save, which
// re-renders the dashboard: the hero rolls down (a fall never glows), and
// this card comes back with the bill checked, or goes once there are three.
export function BillsCard({
  lists,
  added,
  dismissToken,
}: {
  lists: BillsFormLists;
  added: string[];
  /** This user's dismiss cookie value (lib/paydaySkipToken.ts). */
  dismissToken: string;
}) {
  const headingId = useId();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <section aria-labelledby={headingId} className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 id={headingId} className="text-sm font-medium text-ink">
          Have regular bills? Add them for a sharper Safe to Spend.
        </h2>
        <button
          type="button"
          onClick={() => {
            document.cookie = billsCardDismissCookie(dismissToken, window.location.protocol === "https:");
            setDismissed(true);
          }}
          className="inline-flex min-h-9 shrink-0 items-center rounded px-1 text-xs font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Dismiss
        </button>
      </div>
      <div className="mt-3">
        <BillsPrompt lists={lists} added={added} />
      </div>
    </section>
  );
}
