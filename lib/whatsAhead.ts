// The "What's ahead" block beneath the safe-to-spend breakdown, as plain
// strings -- pure so the copy rules are unit tested (lib/whatsAhead.test.ts)
// and the component only lays them out.
//
// Copy is for someone whose money is fine and is just looking at the month
// ahead: it states the figure, names the day, names the cause. Severity is
// carried by the wording alone ("short" vs "below your cushion") -- never a
// colour, an icon or an exclamation mark.

import { amountBasisLabel } from "@/lib/amountBasis";
import { formatCurrency, formatDateWithWeekday, formatDayMonth } from "@/lib/format";
import type { ProjectedObligation, SafeToSpendProjection, SqueezeEpisode } from "@/lib/safeToSpendProjection";

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

  const named = e.drivers.slice(0, MAX_DRIVERS_NAMED).map((o) => `${o.name} (${formatCurrency(o.amount)}, ${amountBasisLabel(o.basis)})`);
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
  data: Pick<SafeToSpendProjection, "episodes" | "cushion" | "mode" | "horizonEnd" | "trough" | "daily">,
): WhatsAhead {
  if (data.episodes.length === 0) {
    // A projection always runs at least five weeks; the no-paycheck window
    // can be shorter, so it names its own end instead. The second sentence
    // ties the line to the figure: the low point it's measured from, and
    // the cushion it stays clear of. "Doesn't go below" holds at exactly
    // the cushion too -- that day is clear, not tight.
    const clear =
      data.mode === "projection" ? "No tight days in the next five weeks." : `No tight days through ${day(data.horizonEnd)}.`;
    const low = `${formatCurrency(data.trough.amount)} ${onDay(data.trough.date, todayOf(data))}`;
    const line = data.cushion > 0 ? `below your ${formatCurrency(data.cushion)} cushion` : "below zero";
    return { kind: "clear", line: `${clear} Your lowest point, ${low}, doesn't go ${line}.` };
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

// ---------------------------------------------------------------------------
// Why the figure is what it is (docs/Safe-to-Spend-Why.md).
//
// Dates are the weekday and date, or "today" -- never "tomorrow" or any
// other relative word: those go stale on a page left open and are
// ambiguous near midnight.
// ---------------------------------------------------------------------------

/** The walk starts on the user's today, so its first day is today. */
function todayOf(data: Pick<SafeToSpendProjection, "daily" | "trough">): string {
  return data.daily[0]?.date ?? data.trough.date;
}

/** "today", or "Wednesday 11 November". */
function dayName(iso: string, today: string): string {
  return iso === today ? "today" : formatDateWithWeekday(iso);
}

/** "today", or "on Wednesday 11 November". */
function onDay(iso: string, today: string): string {
  return iso === today ? "today" : `on ${formatDateWithWeekday(iso)}`;
}

const MAX_TROUGH_ITEMS_NAMED = 2;

/** "Rent comes out" / "Rent and Car come out" / "Rent, Car and 2 more come out". */
function comesOut(obligations: ProjectedObligation[]): string {
  const sorted = [...obligations].sort((a, b) => b.amount - a.amount);
  const named = sorted.slice(0, MAX_TROUGH_ITEMS_NAMED).map((o) => o.name);
  const rest = sorted.length - named.length;
  const parts = rest > 0 ? [...named, `${rest} more`] : named;
  return `${list(parts)} ${sorted.length === 1 ? "comes" : "come"} out`;
}

export type WhyThisNumber = {
  /** The cause -- on the closed card, beside the figure. */
  cause: string;
  /** What follows from it -- first in the breakdown. null when the figure is $0. */
  consequence: string | null;
};

export function whyThisNumber(
  data: Pick<SafeToSpendProjection, "trough" | "after" | "safeToSpend" | "horizonEnd" | "daily">,
): WhyThisNumber {
  const today = todayOf(data);
  const { trough, after } = data;

  let cause: string;
  if (trough.date !== today) {
    // A later trough always has obligations: the walk only moves the
    // trough on a day something comes out.
    cause = `Your tightest day is ${formatDateWithWeekday(trough.date)}, after ${comesOut(trough.obligations)}.`;
  } else if (trough.obligations.length > 0) {
    cause = `Today is your tightest day, after ${comesOut(trough.obligations)}.`;
  } else {
    cause = "Today is your tightest day. Nothing ahead takes your balance below where it is now.";
  }

  // Room against a figure already at $0 would mislead: nothing can lower it.
  if (data.safeToSpend <= 0) return { cause, consequence: null };

  let consequence: string;
  if (after === null) {
    consequence = `Anything dated through ${dayName(data.horizonEnd, today)} comes off this figure in full.`;
  } else if (after.date === trough.date) {
    consequence = `Anything dated after ${dayName(after.date, today)} leaves this figure as it is, up to ${formatCurrency(
      after.room,
    )} in total.`;
  } else {
    // A later day falls exactly as low: everything up to it still counts in full.
    consequence = `Anything dated through ${dayName(after.date, today)} comes off this figure in full. After that, up to ${formatCurrency(
      after.room,
    )} in total leaves it as it is.`;
  }
  return { cause, consequence };
}

/**
 * After a save: say the figure didn't move, and why -- only when that's
 * provably true. The saved row must be one the projection counts as an
 * outflow (matched by id, so the classifier decides, not this), dated
 * after the last tightest day of the projection taken AFTER the save. A
 * row past that day can't reach the day that sets the trough, so the
 * figure is what it was before the save; no before/after comparison is
 * needed. Silent whenever that isn't certain.
 */
export function figureUnchangedNote(
  data: Pick<SafeToSpendProjection, "trough" | "after" | "safeToSpend" | "obligations" | "daily">,
  savedIds: readonly string[],
): string | null {
  if (data.safeToSpend <= 0 || data.after === null) return null;
  const saved = data.obligations.find((o) => o.transactionId !== null && savedIds.includes(o.transactionId));
  if (!saved || saved.date <= data.after.date) return null;
  return `Saved. This doesn't change your safe-to-spend figure — your tightest day is ${dayName(
    data.trough.date,
    todayOf(data),
  )}, before this.`;
}

// How the forecast is cautious, said once for bills and pay together. The
// queue and the upcoming list show each bill's usual amount; the figure
// counts its recent high (and a paycheck's recent low), so the breakdown
// names the difference rather than leaving two numbers to disagree.
export function cautionLine(cautious: { billsAtHigh: boolean; payAtLow: boolean }): string | null {
  if (cautious.billsAtHigh && cautious.payAtLow) {
    return "Variable bills are counted at their recent high, and variable pay at its recent low.";
  }
  if (cautious.billsAtHigh) return "Variable bills are counted at their recent high.";
  if (cautious.payAtLow) return "Variable pay is counted at its recent low.";
  return null;
}
