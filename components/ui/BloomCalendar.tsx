"use client";

import { useEffect, useState } from "react";
import { parseLocalDate } from "@/lib/date";
import { useValueChange } from "./useValueChange";

// The goal pace's month, as a small calendar page (docs/Decide-and-Grow.md,
// section H). It flips only when the estimate changes: while it's on screen
// (a contribution moves the bloom month), or since it was last seen on this
// device (localStorage, per goal -- the goal stem's pattern). A plain load
// with the same month moves nothing. Reduced motion: the month just shows.
//
// Decorative: the month is in the sentence beside it, so the page is
// aria-hidden and a screen reader reads the words, not the flip.

const STORAGE_PREFIX = "goal-bloom-";

/** "2027-05-01" -> 202705, so the month can ride the value-change hook. */
function monthKey(monthISO: string): number {
  return Number(monthISO.slice(0, 4)) * 100 + Number(monthISO.slice(5, 7));
}

function readLastSeen(goalId: string): string | null {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + goalId);
  } catch {
    return null;
  }
}

function writeLastSeen(goalId: string, monthISO: string) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + goalId, monthISO);
  } catch {
    // Unavailable: the page still shows the month; it just won't remember.
  }
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function BloomCalendar({ goalId, month }: { goalId: string; month: string }) {
  const change = useValueChange(monthKey(month));
  // Bumped to restart the flip: the key remounts the page, replaying the
  // animation once. 0 = no flip yet.
  const [flips, setFlips] = useState(0);

  // Since last seen: once per real mount, deferred to a frame (StrictMode's
  // dev double invoke cancels the first pass, as in GoalStem).
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const last = readLastSeen(goalId);
      writeLastSeen(goalId, month);
      if (last !== null && last !== month && !reducedMotion()) setFlips((n) => n + 1);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On screen: the estimate moved while it was showing.
  useEffect(() => {
    if (change.seq === 0) return;
    writeLastSeen(goalId, month);
    if (reducedMotion()) return;
    const t = setTimeout(() => setFlips((n) => n + 1), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change.seq]);

  const date = parseLocalDate(month);
  const name = date.toLocaleDateString("en-US", { month: "short" });
  const year = date.getFullYear();

  return (
    <span aria-hidden="true" className="bloom-cal inline-block shrink-0">
      <span
        key={flips}
        className={`flex h-11 w-10 flex-col overflow-hidden rounded-md border border-hairline bg-surface-raised text-center ${
          flips > 0 ? "bloom-cal__page--flip" : ""
        }`}
      >
        <span className="bg-[color-mix(in_srgb,var(--action)_22%,var(--surface-raised))] py-0.5 text-[10px] font-medium leading-none text-ink-secondary">
          {year}
        </span>
        <span className="flex flex-1 items-center justify-center text-xs font-semibold uppercase text-ink">{name}</span>
      </span>
    </span>
  );
}
