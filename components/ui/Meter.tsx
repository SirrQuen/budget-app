const TONE_VAR = {
  good: "var(--good)",
  warning: "var(--warning)",
} as const;

type MeterTone = keyof typeof TONE_VAR;

export function Meter({
  value,
  target = 100,
  toneFrom = "good",
  toneTo = "warning",
  label,
  ariaLabel,
}: {
  value: number;
  /** Where the fill reaches full toneTo colour and a target marker appears
   * once value passes it -- 100 for a percent-used reading by default. */
  target?: number;
  toneFrom?: MeterTone;
  toneTo?: MeterTone;
  label?: string;
  ariaLabel?: string;
}) {
  const pct = target > 0 ? (value / target) * 100 : 0;
  // Ratio drives colour only, clamped to [0,1] -- once value reaches target
  // the fill holds at toneTo rather than continuing to shift, since there's
  // no tone past it (no budget/goal state ever reaches critical here).
  const ratio = target > 0 ? Math.min(1, Math.max(0, value / target)) : value > 0 ? 1 : 0;
  const isOverTarget = target > 0 && value > target;

  // Past target, the track's own scale grows to fit the overage (with a
  // little headroom so the fill never touches the far edge) instead of
  // clamping the fill at 100% -- the target marker then lands wherever
  // "100%" now falls, and the fill visibly runs past it.
  const scaleMax = isOverTarget ? value * 1.08 : target;
  const fillWidthPct = scaleMax > 0 ? Math.min(100, (value / scaleMax) * 100) : 0;
  const markerLeftPct = isOverTarget && scaleMax > 0 ? (target / scaleMax) * 100 : null;

  // Continuous colour, not a threshold snap -- interpolates from toneFrom
  // at value 0 to toneTo at value === target.
  const fillColor = `color-mix(in srgb, ${TONE_VAR[toneTo]} ${ratio * 100}%, ${TONE_VAR[toneFrom]})`;

  return (
    <div className="w-full">
      {label ? (
        <div className="mb-1.5 flex items-center justify-between text-sm">
          <span className="text-ink-secondary">{label}</span>
          <span className="font-semibold tabular-nums text-ink">{Math.round(pct)}%</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ? undefined : (ariaLabel ?? "Progress")}
        className="relative h-2 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: `color-mix(in srgb, ${fillColor} 22%, var(--page))` }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${fillWidthPct}%`, backgroundColor: fillColor }}
        />
        {markerLeftPct !== null ? (
          <div
            aria-hidden="true"
            className="absolute top-0 h-full w-px bg-ink/40"
            style={{ left: `${markerLeftPct}%` }}
          />
        ) : null}
      </div>
    </div>
  );
}
