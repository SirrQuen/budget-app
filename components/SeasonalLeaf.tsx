"use client";

import { useEffect, useState } from "react";
import type { Season } from "@/lib/timeOfDay";

// The seasonal leaf beside the dashboard greeting (docs/Motion-and-Delight.md,
// step 8). Static by default. It plays once, when the season has changed
// since this device last saw the dashboard -- the same "motion means change"
// rule as the goal stem -- and never loops. The last-seen season is kept in
// localStorage (a per-device convenience; nothing reaches the database). If
// storage is unavailable, or there is nothing to compare with, it stays still.
// Reduced motion: still, always (the animation lives inside the
// no-preference media query in globals.css, and is not started at all).

const STORAGE_KEY = "season-seen";
const SEASONS: readonly string[] = ["spring", "summer", "autumn", "winter"];

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function SeasonalLeaf({ season, size = 28 }: { season: Season; size?: number }) {
  const [play, setPlay] = useState(false);

  // Deferred a frame, like the goal stem's mount effect, so StrictMode's dev
  // double invoke cancels the first pass before it reads and writes.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      try {
        const last = window.localStorage.getItem(STORAGE_KEY);
        window.localStorage.setItem(STORAGE_KEY, season);
        if (last !== null && last !== season && SEASONS.includes(last) && !reducedMotion()) setPlay(true);
      } catch {
        // Storage unavailable: no comparison, no animation.
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [season]);

  return (
    <svg
      key={season}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      data-season={season}
      className={`season-leaf season-leaf--${season} shrink-0 ${play ? "season-leaf--play" : ""}`}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {season === "spring" ? (
        <>
          <path d="M16 29 V17" stroke="var(--ink-secondary)" strokeWidth={2} />
          <g className="season-leaf__a">
            <path d="M16 18 C10 18 6 14 6 9 C12 9 16 12 16 18 Z" fill="var(--action)" />
            <path d="M16 15 C16 10 19 7 25 7 C25 12 21 15 16 15 Z" fill="var(--action)" />
          </g>
        </>
      ) : null}
      {season === "summer" ? (
        <>
          <path d="M16 29 V6" stroke="var(--ink-secondary)" strokeWidth={2} />
          <g className="season-leaf__a">
            <path d="M16 24 C9 24 5 20 5 15 C12 15 16 18 16 24 Z" fill="var(--action)" />
            <path d="M16 20 C16 15 20 11 27 11 C27 17 23 20 16 20 Z" fill="var(--action)" />
            <path d="M16 13 C11 13 8 10 8 6 C13 6 16 8 16 13 Z" fill="var(--action)" />
          </g>
        </>
      ) : null}
      {season === "autumn" ? (
        <>
          <path d="M16 29 V22" stroke="var(--ink-secondary)" strokeWidth={2} />
          <g className="season-leaf__a">
            <path d="M16 22 C8 20 6 12 8 6 C16 6 24 10 24 16 C24 20 20 22 16 22 Z" fill="var(--action)" />
            <path d="M16 22 C15 17 14 13 11 9" stroke="var(--surface)" strokeWidth={1.2} opacity={0.5} />
          </g>
        </>
      ) : null}
      {season === "winter" ? (
        <>
          <path d="M16 29 V8 M16 20 L10 14 M16 15 L22 9" stroke="var(--ink-secondary)" strokeWidth={2} />
          <g className="season-leaf__a" stroke="var(--ink-secondary)" strokeWidth={1.4}>
            <path d="M5 8 H9 M7 6 V10" />
            <path d="M23 18 H27 M25 16 V20" />
            <path d="M22 4 H25 M23.5 2.5 V5.5" />
          </g>
        </>
      ) : null}
    </svg>
  );
}
