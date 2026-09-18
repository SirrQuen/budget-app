import { parseLocalDate } from "@/lib/date";
import { StreakMark, streakMarkLabel } from "@/components/ui/StreakMark";
import { formatStreakLine, type StreakSegment } from "@/lib/streak";

export interface LoggingStreakStripProps {
  current: number;
  longest: number;
  /** Monday-first, 7 entries -- see deriveLoggingStreak. */
  segments: StreakSegment[];
  /** Set only on the render right after grace was silently applied, e.g.
   * "we covered Tuesday for you". Parent decides how long it stays visible;
   * this component just renders it while present. */
  graceDisclosure?: string | null;
}

const WEEKDAY_INITIAL = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });

/**
 * A small status element, not a card -- no border/background of its own.
 * Meant to sit inline in whatever section places it (dashboard's "Right
 * now"). Marks stay in a row always; only the caption line drops below
 * them under the sm breakpoint.
 */
export function LoggingStreakStrip({ current, longest, segments, graceDisclosure }: LoggingStreakStripProps) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
      {/* TODO: milestone mark -- Sorrel trefoil, once the rename lands and
          an asset exists. Do not reuse the EverNest nest logo.svg for this;
          it belongs to the old brand. Would sit just before the count. */}
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            {segments.map((segment) => (
              <StreakMark key={segment.date} status={segment.status} size={20} />
            ))}
          </div>
          <div className="flex gap-2">
            {segments.map((segment) => (
              <span key={segment.date} className="w-5 text-center text-[10px] text-ink-muted" aria-hidden="true">
                {WEEKDAY_INITIAL.format(parseLocalDate(segment.date))}
              </span>
            ))}
          </div>
        </div>
        <span className="text-4xl font-semibold text-ink" style={{ fontVariantNumeric: "tabular-nums" }}>
          {current}
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        <p className="text-xs text-ink-secondary">{formatStreakLine(current, longest)}</p>
        {graceDisclosure ? <p className="text-xs text-ink-secondary">{graceDisclosure}</p> : null}
      </div>

      <ul className="sr-only">
        {segments.map((segment) => (
          <li key={segment.date}>{streakMarkLabel(segment)}</li>
        ))}
      </ul>
    </div>
  );
}
