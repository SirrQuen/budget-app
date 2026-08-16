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
}: {
  /** Sentence case, e.g. "Current monthly balance". */
  label: string;
  value: number;
  format?: "number" | "currency";
  delta?: { value: number; periodLabel: string; format?: "currency" | "number" | "percent" };
}) {
  const displayValue = formatCompactNumber(value, { currency: format === "currency" });
  const deltaParts = delta ? formatDelta(delta.value, { format: delta.format }) : null;

  return (
    <div className="rounded-2xl border border-gridline bg-surface p-4">
      <p className="text-sm font-medium text-ink-secondary">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{displayValue}</p>
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
