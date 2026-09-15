"use client";

import { useState, useTransition } from "react";
import { setSafeToSpendWindowAction } from "@/lib/actions/settings";
import {
  SAFE_TO_SPEND_WINDOWS,
  SAFE_TO_SPEND_WINDOW_LABELS,
  type SafeToSpendWindowPref,
} from "@/lib/safeToSpendWindow";
import { WarningIcon } from "@/components/ui/icons";

// Radiogroup-pill treatment, same shape as components/theme/ThemeToggle.tsx
// -- three states of one setting, arrow-key traversal, a single tab stop.
// No global provider needed here (unlike theme, which paints chrome before
// hydration): this preference is only read server-side, by
// getSafeToSpend(), so a plain local state + Server Action is enough.
export function SafeToSpendWindowToggle({
  initialPref,
  className = "",
}: {
  /**
   * The account's stored preference, already resolved server-side to one
   * of the three concrete options -- never a 4th "auto" state. When
   * nothing's been chosen yet, app/(app)/settings/page.tsx passes whichever
   * option the dynamic default (next payday if an income schedule exists,
   * else end of month) currently resolves to, so the control always shows
   * a real selection.
   */
  initialPref: SafeToSpendWindowPref;
  className?: string;
}) {
  const [pref, setPref] = useState(initialPref);
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();

  const choose = (next: SafeToSpendWindowPref) => {
    setPref(next);
    setError(null);

    startTransition(async () => {
      const result = await setSafeToSpendWindowAction(next);
      if (result?.error) {
        setError(result.error);
      }
    });
  };

  return (
    <div className={className}>
      <div
        role="radiogroup"
        aria-label="Safe-to-spend window"
        className="inline-flex flex-wrap gap-1 rounded-full border border-hairline bg-surface p-1"
      >
        {SAFE_TO_SPEND_WINDOWS.map((option) => {
          const selected = pref === option;

          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => choose(option)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
                  return;
                }

                event.preventDefault();
                const step = event.key === "ArrowRight" ? 1 : -1;
                const next =
                  SAFE_TO_SPEND_WINDOWS[
                    (SAFE_TO_SPEND_WINDOWS.indexOf(pref) + step + SAFE_TO_SPEND_WINDOWS.length) %
                      SAFE_TO_SPEND_WINDOWS.length
                  ];
                choose(next);
              }}
              className={`min-h-11 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                selected
                  ? "bg-action text-action-ink"
                  : "text-ink-secondary hover:bg-surface-raised hover:text-ink"
              }`}
            >
              {SAFE_TO_SPEND_WINDOW_LABELS[option]}
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="mt-2 min-h-5 text-sm">
        {error ? (
          <p className="flex items-start gap-2 text-ink-secondary">
            <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-critical" aria-hidden="true" />
            {error}
          </p>
        ) : saving ? (
          <p className="text-ink-muted">Saving…</p>
        ) : null}
      </div>
    </div>
  );
}
