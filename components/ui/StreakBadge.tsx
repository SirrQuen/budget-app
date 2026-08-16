import { FlameIcon } from "@/components/ui/icons";

export function StreakBadge({ days, best }: { days: number; best: number }) {
  return (
    <div className="inline-flex flex-col items-center gap-0.5 rounded-2xl border border-gridline bg-surface px-4 py-3">
      <div className="flex items-center gap-1.5">
        <FlameIcon className="h-5 w-5 text-warning" aria-hidden="true" />
        <span className="text-xl font-semibold text-ink">{days}</span>
        <span className="text-sm text-ink-secondary">day{days === 1 ? "" : "s"}</span>
      </div>
      <p className="text-xs text-ink-muted">best: {best}</p>
    </div>
  );
}
