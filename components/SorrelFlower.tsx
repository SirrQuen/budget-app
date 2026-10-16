"use client";

import { useId, useState } from "react";

type FlowerState = "open" | "folded";

type SorrelFlowerProps = {
  size?: number;
  state?: FlowerState;
  // Waiting for data: a slow sway, the flower held in its current state.
  // Never the fold -- the fold means one thing, that the time of day changed.
  swaying?: boolean;
};

// The leaflet from components/SorrelMark.tsx, copied rather than imported.
// The duplicate is deliberate: sharing it coupled the dashboard flower to the
// brand mark, and the mark must be provably untouched by flower work. See
// "Sorrel flower: the leaflet path lives in two files" in
// docs/phase-7-findings.md before deduplicating.
const LEAFLET =
  "M 50 50 C 44 36, 24 32, 24 18 C 24 8, 36 2, 44 8 C 47 10, 48.5 12, 50 16 C 51.5 12, 53 10, 56 8 C 64 2, 76 8, 76 18 C 76 32, 56 36, 50 50 Z";

// Rises from the junction to (53,24): vertical where it leaves the junction,
// one bend near the top. Stroked 8.33 units = 2px at 24px. While open it lies
// under leaflet 1 and rests at opacity 0 (see .sorrel-flower__stem).
const STEM = "M 50 50 Q 50 33 53 24";

/**
 * The dashboard flower: wood sorrel, which folds its leaflets down at night.
 * Open is the brand mark's silhouette, stem hidden beneath leaflet 1. Folded,
 * the leaflets hang from the junction around the revealed stem -- taller than
 * wide, where open is wider than tall. All motion is CSS (.sorrel-flower in
 * app/globals.css); changing `state` is the whole fold. Decorative.
 *
 * Not the brand mark. /login, the nav, OG images and favicons use
 * SorrelMark, which has no stem and is never edited for this component.
 */
export function SorrelFlower({ size = 56, state = "open", swaying = false }: SorrelFlowerProps) {
  // The fold plays only on a change, never on mount: a flower that mounts
  // folded at night must arrive folded, not fold in front of the user. The
  // previous state is kept in state (React's "adjusting state on a prop
  // change" pattern), so no ref is read or written during render.
  const [prev, setPrev] = useState(state);
  const [motion, setMotion] = useState<"fold" | "unfold" | null>(null);
  if (state !== prev) {
    setPrev(state);
    setMotion(state === "folded" ? "fold" : "unfold");
  }

  // useId's output contains characters url(#...) won't take.
  const shadeId = `sorrel-shade-${useId().replace(/[^\w-]/g, "")}`;

  const classes = [
    "sorrel-flower",
    `sorrel-flower--${state}`,
    motion && `sorrel-flower--${motion}`,
    swaying && "sorrel-flower--sway",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={classes}
      style={{ color: "var(--mark)" }}
    >
      <defs>
        {/* Static surface shading, in the leaflet's own frame (hinge at
            50,50, tip toward 50,5), so it turns and folds with each leaflet.
            Lighter at the hinge. Never animated. */}
        <linearGradient id={shadeId} gradientUnits="userSpaceOnUse" x1="50" y1="50" x2="50" y2="5">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      <g className="sorrel-flower__sway">
        <g className="sorrel-flower__lift">
          {/* Painted first, so leaflet 1 covers it while open. */}
          <path
            className="sorrel-flower__stem"
            d={STEM}
            fill="none"
            stroke="currentColor"
            strokeWidth={8.33}
            strokeLinecap="round"
          />
          {/* Back (1) to front (2, 3): paint order and stagger order. */}
          {[1, 2, 3].map((n) => (
            <g key={n} className={`sorrel-flower__leaf sorrel-flower__leaf--${n}`}>
              <path d={LEAFLET} />
              <path d={LEAFLET} fill={`url(#${shadeId})`} />
            </g>
          ))}
        </g>
      </g>
    </svg>
  );
}
