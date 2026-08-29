"use client";

import { useEffect, useRef, useState } from "react";
import { formatCompactNumber, formatDelta, type Tone } from "@/lib/format";
import { toneClassName } from "@/components/ui/Amount";
import { Sparkline } from "@/components/ui/Sparkline";

const STORAGE_PREFIX = "stat-tile-";
const DURATION_MS = 600;

function readStoredValue(id: string): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    // Private window or storage disabled -- animate from zero instead.
    return null;
  }
}

function writeStoredValue(id: string, value: number) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, String(value));
  } catch {
    // Same as above -- the tile still renders correctly, it just won't
    // remember this value for next visit.
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function StatTile({
  id,
  label,
  value,
  format = "number",
  delta,
  footnote,
  trend,
  size = "default",
}: {
  /** Unique across the page -- keys this tile's last-seen value in localStorage. */
  id: string;
  /** Sentence case, e.g. "Current monthly balance". */
  label: string;
  value: number;
  format?: "number" | "currency";
  delta?: {
    value: number;
    periodLabel: string;
    format?: "currency" | "number" | "percent";
    /**
     * Which direction is good news -- decides the delta's colour. "up" by
     * default. A delta is only ever `good` or neutral ink here: the wrong
     * direction is plain, never critical. Spending going up, for instance,
     * is neutral, not an alarm.
     */
    goodWhen?: "up" | "down";
  };
  /**
   * A muted secondary line where the delta would sit, for a stat that has
   * no period-over-period delta (e.g. a streak's all-time best). Ignored
   * when `delta` is set.
   */
  footnote?: string;
  /**
   * Oldest-first trend points -- a sparkline renders when at least two of
   * them differ. A flat or one-point series draws nothing.
   */
  trend?: number[];
  /**
   * "hero" is the >=48px, one-per-view figure the design language calls
   * for -- reach for it on the single most important number on a page,
   * never for a row of secondary stats (those stay "default").
   */
  size?: "default" | "hero";
}) {
  // SSR-safe defaults: the server can't read localStorage or matchMedia, so
  // the first client render has to start from the same neutral state (0,
  // not animating) or React flags a hydration mismatch the moment this tile
  // has a real stored value to animate from. The effect below is the
  // earliest point either API is actually read.
  const [displayValue, setDisplayValue] = useState(0);
  const [animating, setAnimating] = useState(false);
  const mountTweenDone = useRef(false);

  // Runs once per real mount: animates from the last-seen value (or zero)
  // toward the current one, then overwrites storage. Deliberately not keyed
  // on `value` -- a later prop change (e.g. a revalidated page) isn't a
  // "return visit" and shouldn't replay the tween.
  //
  // The read of localStorage, the write back to it, and every setState call
  // all happen inside the single `begin` callback below, deferred via one
  // rAF -- never synchronously in the effect body. That's what makes
  // StrictMode's dev-only double-invoke harmless: cleanup cancels the first
  // pass's rAF before `begin` ever runs, so its read-then-write never
  // happens; only the second pass's `begin` actually fires, and it reads
  // the real last-seen value rather than a value the first pass already
  // overwrote.
  useEffect(() => {
    let raf = 0;

    const begin = () => {
      const reducedMotion = prefersReducedMotion();
      const start = reducedMotion ? value : (readStoredValue(id) ?? 0);
      writeStoredValue(id, value);

      if (reducedMotion) {
        setDisplayValue(value);
        mountTweenDone.current = true;
        return;
      }

      setAnimating(true);
      // A no-op delta (nothing changed since last visit) still runs through
      // this same path -- duration just collapses to one frame instead of a
      // redundant 600ms hold.
      const duration = start === value ? 0 : DURATION_MS;
      let startTime: number | null = null;

      const tick = (now: number) => {
        if (startTime === null) startTime = now;
        const t = duration <= 0 ? 1 : Math.min(1, (now - startTime) / duration);
        const eased = easeOutCubic(t);
        setDisplayValue(start + (value - start) * eased);
        if (t < 1) {
          raf = requestAnimationFrame(tick);
        } else {
          setAnimating(false);
          mountTweenDone.current = true;
        }
      };

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(begin);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keeps the figure live for the rest of the tile's lifetime: once the
  // mount tween above has resolved, a later `value` change (e.g. a
  // revalidated page after logging a contribution) still needs to reach the
  // screen -- it just does so directly, without replaying the last-seen
  // animation, since that's reserved for an actual return visit.
  useEffect(() => {
    if (!mountTweenDone.current) return;
    setDisplayValue(value);
  }, [value]);

  const displayText = formatCompactNumber(displayValue, { currency: format === "currency" });
  const deltaParts = delta ? formatDelta(delta.value, { format: delta.format }) : null;

  // Colour by direction x whether that direction is good -- never by the
  // sign alone (that's formatDelta's own `tone`, which we deliberately drop
  // here). The losing direction is neutral ink, not critical.
  let deltaTone: Tone = "neutral";
  if (delta && delta.value !== 0) {
    const wentUp = delta.value > 0;
    const upIsGood = (delta.goodWhen ?? "up") === "up";
    deltaTone = wentUp === upIsGood ? "good" : "neutral";
  }

  const showSparkline = trend != null && new Set(trend).size > 1;

  return (
    <div className="rounded-2xl border border-hairline bg-surface p-4">
      <p className="text-sm font-medium text-ink-secondary">{label}</p>
      <p
        className={`mt-1 font-semibold text-ink ${size === "hero" ? "text-5xl" : "text-2xl"} ${animating ? "tabular-nums" : ""}`}
      >
        {displayText}
      </p>
      {deltaParts ? (
        <p className={`mt-1 flex items-center gap-1 text-sm ${toneClassName(deltaTone)}`}>
          <span aria-hidden="true">{deltaParts.arrow}</span>
          <span>{deltaParts.text}</span>
          <span className="text-ink-muted">vs {delta!.periodLabel}</span>
        </p>
      ) : !delta && footnote ? (
        <p className="mt-1 text-sm text-ink-muted">{footnote}</p>
      ) : null}
      {showSparkline ? <Sparkline values={trend} className="mt-3" /> : null}
    </div>
  );
}
