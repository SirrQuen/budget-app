"use client";

import { useEffect, useState } from "react";
import { rollCells, type ValueChange } from "@/lib/valueChange";
import { useReducedMotion } from "@/components/ui/useReducedMotion";

// A figure whose digits roll when its value changes while on screen
// (docs/Motion-and-Delight.md, step 2): up a line for a rise, down for a
// fall. A rise also gets a glow behind it; a fall gets nothing -- no glow,
// no colour, no shake. At rest it is plain text, so first load shows the
// number still.
//
// Screen readers get the result, not the motion: the rolling glyphs are
// aria-hidden, and the real figure sits in a polite live region, so a
// change is announced once, as its final value.
export function RollingFigure({
  text,
  previousText,
  change,
  glow: allowGlow = true,
  className = "",
}: {
  /** The figure as it should read. */
  text: string;
  /** The figure it was before the latest change; null when none. */
  previousText: string | null;
  change: ValueChange;
  /** A rise glows behind the figure. Only the hero asks for it: a tile of income or spending never rewards a direction. */
  glow?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  // The change number whose roll has finished. A new change reopens it.
  const [settled, setSettled] = useState(0);
  const rolling = !reduced && change.direction !== null && previousText !== null && settled !== change.seq;
  const glow = allowGlow && !reduced && change.direction === "up";

  // The animation's own end settles the roll; this is the backstop for a
  // hidden tab or a browser that never fires it -- the plain figure is
  // never left waiting on an event.
  useEffect(() => {
    if (!rolling) return;
    const seq = change.seq;
    const timer = setTimeout(() => setSettled(seq), 700);
    return () => clearTimeout(timer);
  }, [rolling, change.seq]);

  return (
    <span className={`relative isolate inline-block leading-[1.15] ${className}`}>
      {glow ? <span key={change.seq} className="figure-glow" aria-hidden="true" /> : null}
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {text}
      </span>
      {rolling ? (
        <span
          key={change.seq}
          aria-hidden="true"
          onAnimationEnd={() => setSettled(change.seq)}
        >
          {rollCells(previousText, text).map((cell, i) =>
            cell.changed ? (
              <span key={i} className="roll-digit">
                <span className={`roll-track roll-track--${change.direction}`}>
                  {change.direction === "up" ? (
                    <>
                      <span>{cell.from}</span>
                      <span>{cell.to}</span>
                    </>
                  ) : (
                    <>
                      <span>{cell.to}</span>
                      <span>{cell.from}</span>
                    </>
                  )}
                </span>
              </span>
            ) : (
              <span key={i}>{cell.to}</span>
            ),
          )}
        </span>
      ) : (
        <span aria-hidden="true">{text}</span>
      )}
    </span>
  );
}
