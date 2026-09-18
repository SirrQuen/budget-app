import { parseLocalDate } from "@/lib/date";
import type { StreakDayStatus, StreakSegment } from "@/lib/streak";

const WEEKDAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: "long" });

/** Full sentence for the sr-only day list -- earned, grace and unearned
 * days each get their own wording, per an accessible mark. */
export function streakMarkLabel(segment: StreakSegment): string {
  const weekday = WEEKDAY_FORMAT.format(parseLocalDate(segment.date));
  switch (segment.status) {
    case "earned":
      return segment.isToday ? `${weekday}, today, logged` : `${weekday}, logged`;
    case "grace":
      return `${weekday}, covered with grace`;
    case "today-pending":
      return `${weekday}, today, not yet logged`;
    case "unearned":
      return `${weekday}, not logged`;
  }
}

export interface StreakMarkProps {
  status: StreakDayStatus;
  size?: number;
}

const STROKE = 1.5;

/**
 * One day's mark, shared by the ring and strip layouts so the state ->
 * visual mapping only lives in one place. Grace is a halo ring around a
 * muted fill, not just a muted colour -- a shape difference that still
 * reads without colour vision. Unearned is a bare 20%-opacity outline, no
 * fill at all, so a missed or not-yet-arrived day never looks "drained."
 */
export function StreakMark({ status, size = 20 }: StreakMarkProps) {
  const c = size / 2;
  const r = c - STROKE;

  if (status === "unearned") {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--ink)" strokeWidth={STROKE} opacity={0.2} />
      </svg>
    );
  }

  if (status === "grace") {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--ink-secondary)" strokeWidth={STROKE} />
        <circle cx={c} cy={c} r={Math.max(r - STROKE - 1.5, 1)} fill="color-mix(in srgb, var(--action) 45%, var(--surface))" />
      </svg>
    );
  }

  const opacity = status === "today-pending" ? 0.4 : 1;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="var(--action)"
        opacity={opacity}
        className="transition-opacity duration-300 ease-out"
      />
    </svg>
  );
}
