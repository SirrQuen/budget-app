"use client";

import { useId, useSyncExternalStore } from "react";
import { FIELD_EDGE } from "@/components/ui/Input";
import { VISITORS_OFF_KEY, writeVisitorKey } from "@/lib/visitors";

// "Visitors on the dashboard" (docs/Visitors.md): a display preference kept
// on this device only -- localStorage, never the database, so there is no
// action and no save. On by default; unavailable storage reads as on (the
// visitor then only ever sits perched). The dashboard reads the key when it
// opens, so the choice applies from the next visit.

const listeners = new Set<() => void>();

function subscribe(notify: () => void) {
  listeners.add(notify);
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}

function readOn(): boolean {
  try {
    return window.localStorage.getItem(VISITORS_OFF_KEY) !== "1";
  } catch {
    return true;
  }
}

export function VisitorsToggle({ className = "" }: { className?: string }) {
  const on = useSyncExternalStore(subscribe, readOn, () => true);
  const labelId = useId();
  const hintId = useId();

  const toggle = () => {
    writeVisitorKey(VISITORS_OFF_KEY, on ? "1" : null);
    for (const notify of [...listeners]) notify();
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="text-sm font-medium text-ink">
          Visitors on the dashboard
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={labelId}
          aria-describedby={hintId}
          onClick={toggle}
          className={`relative h-7 w-12 shrink-0 ${FIELD_EDGE} !rounded-full ${on ? "bg-action" : "bg-surface-raised"}`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-0.5 h-5 w-5 rounded-full transition-transform duration-150 motion-reduce:transition-none ${
              on ? "translate-x-[22px] bg-action-ink" : "translate-x-[2px] bg-ink-secondary"
            }`}
          />
        </button>
      </div>
      <p id={hintId} className="mt-1 max-w-prose text-sm text-ink-secondary">
        A small bird, butterfly, firefly or owl visits the greeting once in each part of the day. Turn it off and none
        will. This is kept on this device.
      </p>
    </div>
  );
}
