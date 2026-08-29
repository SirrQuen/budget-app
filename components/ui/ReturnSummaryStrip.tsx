"use client";

import { useEffect, useRef, useState } from "react";
import { getReturnSummaryFacts } from "@/lib/actions/activity";
import { CloseIcon } from "@/components/ui/icons";

const STORAGE_KEY = "dashboard-last-visit";
// "away more than a few hours" -- short enough that a same-day lunch break
// won't trigger it, long enough that a normal multi-tab session won't either.
const AWAY_THRESHOLD_MS = 4 * 60 * 60 * 1000;

function readLastVisit(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private window or storage disabled -- treat as "never visited" so the
    // strip just stays quiet rather than breaking the page.
    return null;
  }
}

function writeLastVisit(iso: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, iso);
  } catch {
    // Same as above.
  }
}

// "Since Tuesday" / "since yesterday" / "since earlier today" -- a specific
// calendar reference reads warmer than a raw duration ("since 14 hours ago").
function sinceLabel(lastVisit: Date, now: Date): string {
  const lastDay = new Date(lastVisit.getFullYear(), lastVisit.getMonth(), lastVisit.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.round((today.getTime() - lastDay.getTime()) / 86_400_000);

  if (dayDiff <= 0) return "earlier today";
  if (dayDiff === 1) return "yesterday";
  if (dayDiff < 7) return lastVisit.toLocaleDateString(undefined, { weekday: "long" });
  return lastVisit.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ReturnSummaryStrip() {
  const [line, setLine] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    const now = new Date();
    const stored = readLastVisit();
    writeLastVisit(now.toISOString());

    // First visit ever -- nothing to diff against.
    if (!stored) return;

    const lastVisit = new Date(stored);
    if (Number.isNaN(lastVisit.getTime())) return;
    if (now.getTime() - lastVisit.getTime() < AWAY_THRESHOLD_MS) return;

    getReturnSummaryFacts(stored).then((facts) => {
      // Nothing changed -- a strip saying so is worse than no strip.
      if (facts.length === 0) return;
      setLine(`Since ${sinceLabel(lastVisit, now)}: ${facts.join(" · ")}`);
    });
  }, []);

  if (!line || dismissed) return null;

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
