"use client";

import { formatCurrency } from "@/lib/format";
import { useValueChange } from "./useValueChange";

// The one goal meter (docs/Motion-and-Delight.md, step 5): a 10px stem whose
// fill is drawn with transform: scaleX(), with a leaf at 25, 50 and 75%.
// Manual goals, goals with linked transactions and goals that follow a card
// all render it, from the same v_goal_progress figure.
//
// Motion only means change. The fill sits at its final scale on the very
// first render, so a page load or a navigation has nothing to animate; a
// later change to `value` moves it over 700ms, up or down alike. A leaf
// unfurls only in the render where the fill passes it going UP. Going back
// down, a leaf returns to an outline with no animation, no colour and no
// words -- a fall is never marked.
//
// Colour is --action, the theme accent (gold in dark, navy in light), never
// the brand gold as a literal and never a status colour. The track is a
// lighter step of the same hue.

const LEAVES = [25, 50, 75] as const;

const LEAF_PATH = "M12 22 C5 17 4 9 12 2 C20 9 19 17 12 22 Z";

export function GoalStem({
  goalName,
  value,
  toGo,
  complete = false,
}: {
  goalName: string;
  /** 0-100, already clamped by v_goal_progress.pct_complete. */
  value: number;
  /** What's left, in dollars, for the screen reader's text. */
  toGo: number | null;
  /** The goal is finished (reached or paid off): read as such, not as a figure. */
  complete?: boolean;
}) {
  const pct = Math.min(100, Math.max(0, value));
  const change = useValueChange(pct);
  const rounded = Math.round(pct);
  const valueText = complete
    ? `${rounded} percent, complete`
    : toGo === null
      ? `${rounded} percent`
      : `${rounded} percent, ${formatCurrency(toGo)} to go`;

  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-ink-secondary">{goalName}</span>
        <span className="font-semibold tabular-nums text-ink">{rounded}%</span>
      </div>
      <div className="relative pt-3">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-3"
        >
          {LEAVES.map((m) => {
            const passed = pct >= m;
            const unfurl =
              change.direction === "up" && change.previous !== null && change.previous < m && pct >= m;
            return (
              <svg
                key={m}
                viewBox="0 0 24 24"
                width={12}
                height={12}
                focusable="false"
                className={`absolute top-0 -ml-1.5 ${unfurl ? "goal-leaf--unfurl" : ""}`}
                style={{ left: `${m}%`, transformOrigin: "50% 100%" }}
              >
                <path
                  d={LEAF_PATH}
                  fill={passed ? "var(--action)" : "none"}
                  stroke={passed ? "var(--action)" : "var(--ink-muted)"}
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
              </svg>
            );
          })}
        </div>
        <div
          role="progressbar"
          aria-label={goalName}
          aria-valuenow={rounded}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={valueText}
          className="relative h-2.5 w-full overflow-hidden rounded-full"
          style={{ backgroundColor: "color-mix(in srgb, var(--action) 22%, var(--page))" }}
        >
          <div
            className="goal-stem__fill h-full w-full"
            style={{ transform: `scaleX(${pct / 100})`, backgroundColor: "var(--action)" }}
          />
        </div>
      </div>
    </div>
  );
}
