// A bare trend line for a stat tile -- no axes, no labels, no interaction.
// The line sits in de-emphasised ink; only the final point (the current
// period) is picked out, in primary ink with a surface-coloured ring so it
// lifts off the line. Never a data hue: the figure and its signed delta
// already carry the meaning, so this stays neutral chrome.
//
// Purely decorative -- aria-hidden. Callers pass a series with real
// variation; a flat line is filtered upstream (StatTile) rather than drawn.
export function Sparkline({
  values,
  className = "",
}: {
  /** Oldest first. Rendered at a fixed step, so ~12 points is the ceiling. */
  values: number[];
  className?: string;
}) {
  const n = values.length;
  const stepX = 8;
  const pad = 3;
  const width = (n - 1) * stepX + pad * 2;
  const height = 32;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    // Higher value sits higher on screen -- invert, since SVG y grows down.
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return `${x},${y}`;
  });

  const [lastX, lastY] = points[n - 1].split(",").map(Number);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={`text-ink-muted ${className}`}
      aria-hidden="true"
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={lastX}
        cy={lastY}
        r={2.5}
        fill="var(--color-ink)"
        stroke="var(--color-surface)"
        strokeWidth={2}
      />
    </svg>
  );
}
