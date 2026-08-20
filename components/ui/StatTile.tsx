import { formatCompactNumber, formatDelta, type Tone } from "@/lib/format";

const toneClass: Record<Tone, string> = {
  good: "text-good",
  critical: "text-critical",
  neutral: "text-ink-muted",
};

export function StatTile({
  label,
  value,
  format = "number",
  delta,
  size = "default",
}: {
  /** Sentence case, e.g. "Current monthly balance". */
  label: string;
  value: number;
  format?: "number" | "currency";
  delta?: { value: number; periodLabel: string; format?: "currency" | "number" | "percent" };
  /**
   * "hero" is the >=48px, one-per-view figure the design language calls
   * for -- reach for it on the single most important number on a page,
   * never for a row of secondary stats (those stay "default").
   */
  size?: "default" | "hero";
}) {
  const displayValue = formatCompactNumber(value, { currency: format === "currency" });
  const deltaParts = delta ? formatDelta(delta.value, { format: delta.format }) : null;

  return (
    <div className="rounded-2xl border border-hairline bg-surface p-4">
      <p className="text-sm font-medium text-ink-secondary">{label}</p>
      <p
        className={`mt-1 font-semibold text-ink ${size === "hero" ? "text-5xl" : "text-2xl"}`}
      >
        {displayValue}
      </p>
      {deltaParts ? (
        <p className={`mt-1 flex items-center gap-1 text-sm ${toneClass[deltaParts.tone]}`}>
          <span aria-hidden="true">{deltaParts.arrow}</span>
          <span>{deltaParts.text}</span>
          <span className="text-ink-muted">vs {delta!.periodLabel}</span>
        </p>
      ) : null}
    </div>
  );
}
