"use client";

import { useEffect, useRef, useState } from "react";
import { LeafIcon } from "@/components/ui/LeafIcon";
import { SaveLeaves } from "@/components/ui/SaveToast";
import { requestYourSorrel, YOUR_SORREL_LINK_ID } from "@/lib/yourSorrel";
import { syncCelebrations } from "@/lib/milestonesCelebrated";
import type { MilestoneId } from "@/lib/milestones";

const TOAST_MS = 6000;

// Lifetime milestones celebrated on the dashboard (docs/Decide-and-Grow.md,
// J): time with Sorrel, goals, an import -- and any log milestone a queue
// confirmation crossed, which has no save response to carry it. The server
// sends what is earned; THIS DEVICE decides what is new (localStorage, see
// lib/milestonesCelebrated.ts). The first run on a device marks everything
// already earned as celebrated, silently. No notification, no badge, nothing
// written to the database. Reduced motion: the toast, no leaves.
export function MilestoneToast({ earned }: { earned: { id: MilestoneId; label: string }[] }) {
  const [labels, setLabels] = useState<string[]>([]);
  const [seq, setSeq] = useState(0);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Deferred a frame, like the season leaf: StrictMode's double invoke
  // cancels the first pass before it reads and writes.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const fresh = syncCelebrations(earned.map((m) => m.id));
      if (fresh.length === 0) return;
      setLabels(earned.filter((m) => fresh.includes(m.id)).map((m) => m.label));
      setSeq((n) => n + 1);
      timeout.current = setTimeout(() => setLabels([]), TOAST_MS);
    });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout.current);
    };
  }, [earned]);

  if (labels.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-6 z-50 flex flex-col items-center gap-2">
      <div
        role="status"
        className="toast-in pointer-events-auto relative flex max-w-md flex-col items-center gap-1 rounded-2xl border border-hairline bg-surface-raised px-4 py-2 text-sm text-ink shadow-lg"
      >
        <SaveLeaves seq={seq} />
        {labels.map((label) => (
          <span key={label} className="inline-flex items-center gap-2">
            <LeafIcon className="h-3.5 w-3.5 text-gold" />
            {label}
          </span>
        ))}
        {/* Back to the greeting's link when the panel closes: the toast will
            have gone by then. */}
        <button
          type="button"
          onClick={() => {
            requestYourSorrel(document.getElementById(YOUR_SORREL_LINK_ID));
            setLabels([]);
          }}
          className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
        >
          See all
        </button>
      </div>
    </div>
  );
}
