// The "What's ahead" block beneath the safe-to-spend breakdown, as plain
// strings -- pure so the copy rules are unit tested (lib/whatsAhead.test.ts)
// and the component only lays them out.
//
// Copy is for someone whose money is fine and is just looking at the month
// ahead: it states the figure, names the day, names the cause. Severity is
// carried by the wording alone ("short" vs "below your cushion") -- never a
// colour, an icon or an exclamation mark.

import { formatCurrency, formatDayMonth } from "@/lib/format";
import type { SafeToSpendProjection, SqueezeEpisode } from "@/lib/safeToSpendProjection";

export const MAX_EPISODES_SHOWN = 5;
const MAX_DRIVERS_NAMED = 3;

export type WhatsAheadItem = {
  key: string;
  /** "14 October", "14–17 October", "30 September – 2 October". */
  when: string;
  headline: string;
  /** The run holding the trough -- annotated inline, never listed again. */
  isLowestPoint: boolean;
  /** What lands in the run. */
  cause: string;
  /** What ends it, or that it runs past the forecast. */
  recovery: string;
};

export type WhatsAhead =
  | { kind: "clear"; line: string }
  | { kind: "episodes"; items: WhatsAheadItem[]; more: string | null };

const day = (iso: string) => formatDayMonth(iso);

function when(e: SqueezeEpisode): string {
  if (e.startDate === e.endDate) return day(e.startDate);
  // Same month: "14–17 October". formatDayMonth is "14 October".
  const [startDay, ...startMonth] = day(e.startDate).split(" ");
  const end = day(e.endDate);
  return end.endsWith(` ${startMonth.join(" ")}`) ? `${startDay}–${end}` : `${day(e.startDate)} – ${end}`;
}

function headline(e: SqueezeEpisode, cushion: number): string {
  if (e.severity === "shortfall") {
    return `Projected ${formatCurrency(-e.lowPoint.amount)} short on ${day(e.lowPoint.date)}`;
  }
  const on = e.startDate === e.endDate ? "" : ` on ${day(e.lowPoint.date)}`;
  return `Down to ${formatCurrency(e.lowPoint.amount)}, below your ${formatCurrency(cushion)} cushion${on}`;
}

function list(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function cause(e: SqueezeEpisode): string {
  // A run with nothing landing in it can only be one that starts today,
  // from today's balance -- any later start needs an obligation to begin.
  if (e.drivers.length === 0) return "Starts from today's balance.";

  const named = e.drivers.slice(0, MAX_DRIVERS_NAMED).map((o) => `${o.name} (${formatCurrency(o.amount)})`);
  const rest = e.drivers.length - named.length;
  const parts = rest > 0 ? [...named, `${rest} more`] : named;
  const verb = e.drivers.length === 1 ? "lands" : "land";
  const span = e.startDate === e.endDate ? "that day" : "in this stretch";
  return `${list(parts)} ${verb} ${span}.`;
}

function recovery(e: SqueezeEpisode): string {
  if (e.openEnded || e.recovery === null) return "Continues past the end of the forecast.";
  return `Back above your cushion on ${day(e.recovery.date)}, when ${e.recovery.description} comes in.`;
}

export function whatsAhead(
  data: Pick<SafeToSpendProjection, "episodes" | "cushion" | "mode" | "horizonEnd">,
): WhatsAhead {
  if (data.episodes.length === 0) {
    // A projection always runs at least five weeks; the no-paycheck window
    // can be shorter, so it names its own end instead.
    return {
      kind: "clear",
      line:
        data.mode === "projection"
          ? "No tight days in the next five weeks."
          : `No tight days through ${day(data.horizonEnd)}.`,
    };
  }

  const items = data.episodes.slice(0, MAX_EPISODES_SHOWN).map(
    (e): WhatsAheadItem => ({
      key: e.startDate,
      when: when(e),
      headline: headline(e, data.cushion),
      isLowestPoint: e.containsTrough,
      cause: cause(e),
      recovery: recovery(e),
    }),
  );
  const hidden = data.episodes.length - items.length;

  return {
    kind: "episodes",
    items,
    more: hidden > 0 ? `and ${hidden} more later in the forecast` : null,
  };
}
