export function Meter({
  value,
  max = 100,
  warningAt = 70,
  criticalAt = 90,
  label,
  ariaLabel,
}: {
  value: number;
  max?: number;
  /** Percentage of max at which the fill shifts good -> warning. */
  warningAt?: number;
  /** Percentage of max at which the fill shifts warning -> critical. */
  criticalAt?: number;
  label?: string;
  ariaLabel?: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const tone = pct >= criticalAt ? "critical" : pct >= warningAt ? "warning" : "good";
  // Reference the raw :root custom properties (--good/--warning/--critical),
  // not the Tailwind-generated --color-* aliases -- with `@theme inline`,
  // Tailwind only emits a --color-x variable for names it can find as a
  // literal string during content scanning, and `--color-${tone}` is built
  // from a template literal so it's invisible to that scan. The --good etc.
  // names are written directly in globals.css's plain :root block, so they
  // always exist regardless of what Tailwind decides to keep.
  const fillVar = `var(--${tone})`;

  return (
    <div className="w-full">
      {label ? (
        <div className="mb-1.5 flex items-center justify-between text-sm">
          <span className="text-ink-secondary">{label}</span>
          <span className="font-medium text-ink">{Math.round(pct)}%</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ? undefined : (ariaLabel ?? "Progress")}
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: `color-mix(in srgb, ${fillVar} 22%, var(--page))` }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%`, backgroundColor: fillVar }}
        />
      </div>
    </div>
  );
}
