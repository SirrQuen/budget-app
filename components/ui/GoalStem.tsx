"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { useValueChange } from "./useValueChange";

// The one goal meter (docs/Motion-and-Delight.md, step 5): a 10px stem whose
// fill is drawn with transform: scaleX(), with a leaf at 25, 50 and 75%.
// Manual goals, goals with linked transactions and goals that follow a card
// all render it, from the same v_goal_progress figure.
//
// Motion only means change. Two signals count: a change to `value` while
// the stem is on screen, and a difference from the last value seen on this
// device (localStorage, kept per goal) when it mounts. A plain load with no
// difference moves nothing and says nothing. A leaf unfurls once when the
// fill passes it going UP by either signal. Going back down, a leaf returns
// to an outline with no animation, no colour and no words -- a fall is
// never marked. If localStorage is unavailable the end state shows, still.
//
// A milestone crossed by either signal is announced through a polite live
// region (and handed to onMilestone for the visible banner), so a screen
// reader and a reduced-motion user get the moment too. A complete goal
// announces none: the completion panel owns that.
//
// Colour is --action, the theme accent (gold in dark, navy in light), never
// the brand gold as a literal and never a status colour. The track is a
// lighter step of the same hue.

const LEAVES = [25, 50, 75] as const;
type Milestone = (typeof LEAVES)[number];
const STORAGE_PREFIX = "goal-pct-";

function readLastSeen(goalId: string): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + goalId);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
  } catch {
    return null;
  }
}

function writeLastSeen(goalId: string, pct: number) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + goalId, String(pct));
  } catch {
    // Unavailable: the stem still renders; it just won't remember.
  }
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Highest milestone passed going up from `from` to `to`; none at 100. */
export function crossedMilestone(from: number, to: number): Milestone | null {
  if (to >= 100) return null;
  let hit: Milestone | null = null;
  for (const m of LEAVES) if (from < m && to >= m) hit = m;
  return hit;
}

function milestoneMessage(goalName: string, m: Milestone): string {
  return m === 75
    ? `${goalName} is three-quarters there`
    : m === 50
      ? `${goalName} is halfway there`
      : `${goalName} is a quarter there`;
}

const LEAF_PATH = "M12 22 C5 17 4 9 12 2 C20 9 19 17 12 22 Z";

export function GoalStem({
  goalId,
  goalName,
  value,
  toGo,
  complete = false,
  onMilestone,
}: {
  goalId: string;
  goalName: string;
  /** Called with the visible banner's text when a milestone is crossed. */
  onMilestone?: (message: string) => void;
  /** 0-100, already clamped by v_goal_progress.pct_complete. */
  value: number;
  /** What's left, in dollars, for the screen reader's text. */
  toGo: number | null;
  /** The goal is finished (reached or paid off): read as such, not as a figure. */
  complete?: boolean;
}) {
  const pct = Math.min(100, Math.max(0, value));
  const change = useValueChange(pct);
  // Since-last-visit state: `from` is where the fill starts for the first
  // paint after mount (null = the end state); `visitUnfurl` is the leaves
  // that fill passes. Set only by the mount effect below.
  const [from, setFrom] = useState<number | null>(null);
  const [visitUnfurl, setVisitUnfurl] = useState<readonly number[]>([]);
  const [announcement, setAnnouncement] = useState("");

  function announce(message: string) {
    setAnnouncement(message);
    onMilestone?.(message);
  }

  // Once per real mount, deferred to a frame so StrictMode's dev double
  // invoke cancels the first pass before it reads and writes last-seen.
  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    let raf3 = 0;
    raf1 = requestAnimationFrame(() => {
      const last = readLastSeen(goalId);
      writeLastSeen(goalId, pct);
      if (last === null || last === pct) return;
      const crossed = crossedMilestone(last, pct);
      if (crossed !== null) announce(milestoneMessage(goalName, crossed));
      if (reducedMotion()) return;
      setFrom(last);
      raf2 = requestAnimationFrame(() => {
        raf3 = requestAnimationFrame(() => {
          setFrom(null);
          setVisitUnfurl(pct > last ? LEAVES.filter((m) => last < m && pct >= m) : []);
        });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      cancelAnimationFrame(raf3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A change while on screen: remember it as seen, and name a milestone.
  useEffect(() => {
    if (change.seq === 0 || change.previous === null) return;
    writeLastSeen(goalId, pct);
    const crossed = crossedMilestone(change.previous, pct);
    if (crossed === null) return;
    // Deferred a tick, like the mount effect: never a setState in the effect body.
    const t = setTimeout(() => announce(milestoneMessage(goalName, crossed)), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change.seq]);

  useEffect(() => {
    if (announcement === "") return;
    const t = setTimeout(() => setAnnouncement(""), 4000);
    return () => clearTimeout(t);
  }, [announcement]);

  const shown = from ?? pct;
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
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      <div className="relative pt-3">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-3"
        >
          {LEAVES.map((m) => {
            const passed = shown >= m;
            const unfurl =
              (change.direction === "up" && change.previous !== null && change.previous < m && pct >= m) ||
              (from === null && visitUnfurl.includes(m) && pct >= m);
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
            className={`goal-stem__fill h-full w-full ${from !== null ? "goal-stem__fill--instant" : ""}`}
            style={{ transform: `scaleX(${shown / 100})`, backgroundColor: "var(--action)" }}
          />
        </div>
      </div>
    </div>
  );
}
