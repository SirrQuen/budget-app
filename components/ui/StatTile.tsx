"use client";

import { formatCompactNumber, formatDelta, type Tone } from "@/lib/format";
import { toneClassName } from "@/components/ui/Amount";
import { Sparkline } from "@/components/ui/Sparkline";
import { useCountUp } from "@/components/ui/useCountUp";

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
  const { display, animating } = useCountUp(value, id);

  const displayText = formatCompactNumber(display, { currency: format === "currency" });
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
