// The runway and "Can I afford it?" as plain strings (docs/Decide-and-Grow.md,
// F1 and F2) -- pure so the copy rules are unit tested (lib/runway.test.ts).
//
// Every figure here is read from the projection's own result: the lowest
// point, the cushion, the goal money, the floored figure and the signed one
// beside it. Nothing is recomputed -- the one subtraction a reader sees is
// the projection's, written out.
//
// Never judge (rule 3): no "can't afford", "behind", "over" or "missed".
// When something doesn't fit, say when it would. No exclamation marks.

import {
  formatCurrencyInSentence,
  formatDateShort,
  formatDateWithWeekday,
  formatWeekday,
} from "@/lib/format";
import { addDaysISO } from "@/lib/date";
import type { ProjectedObligation, SafeToSpendProjection } from "@/lib/safeToSpendProjection";
import type { WhatIfAnswer } from "@/lib/whatIf";

const MAX_NAMED = 2;

function list(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "Rent", "Rent and Car", "Rent, Car and 2 more" -- largest first, as the tightest-day sentence names them. */
function named(names: string[]): string {
  const shown = names.slice(0, MAX_NAMED);
  const rest = names.length - shown.length;
  return list(rest > 0 ? [...shown, `${rest} more`] : shown);
}

/** "$2,800", or "−$200" below zero -- the breakdown's own "Low point" form. */
export function lowPointFigure(amount: number): string {
  return `${amount < 0 ? "−" : ""}${formatCurrencyInSentence(Math.abs(amount))}`;
}

/**
 * The leaf's label: "Friday 20 November · $2,800 · your lowest point, after
 * Rent" -- the tightest-day sentence's day and items. "Today" when the
 * lowest point is today; no "after" when nothing comes out that day.
 */
export function lowestPointLabel(data: Pick<SafeToSpendProjection, "trough" | "daily">): string {
  const today = data.daily[0]?.date ?? data.trough.date;
  const when = data.trough.date === today ? "Today" : formatDateWithWeekday(data.trough.date);
  const items = [...data.trough.obligations].sort((a, b) => b.amount - a.amount).map((o) => o.name);
  const after = items.length > 0 ? `, after ${named(items)}` : "";
  return `${when} · ${lowPointFigure(data.trough.amount)} · your lowest point${after}`;
}

/**
 * The calculation in one line:
 *   "$2,800 lowest point − $300 cushion − $150 for goals = $2,350 safe to spend."
 * Goal money only when there is some; the cushion only when it isn't $0.
 * When the floor applies, it says so plainly:
 *   "$2,800 lowest point − $3,000 cushion comes to less than $0, so safe to spend is $0."
 */
export function runwayCalculation(
  data: Pick<SafeToSpendProjection, "trough" | "cushion" | "goalHold" | "safeToSpend" | "signedSafeToSpend">,
): string {
  const terms = [`${lowPointFigure(data.trough.amount)} lowest point`];
  if (data.cushion > 0) terms.push(`${formatCurrencyInSentence(data.cushion)} cushion`);
  if (data.goalHold > 0) terms.push(`${formatCurrencyInSentence(data.goalHold)} for goals`);
  const left = terms.join(" − ");
  if (data.signedSafeToSpend < 0) {
    return `${left} comes to less than $0, so safe to spend is $0.`;
  }
  return `${left} = ${formatCurrencyInSentence(data.safeToSpend)} safe to spend.`;
}

/** What a point on the runway is, for its door and its row in the list. */
export function itemHref(item: Pick<ProjectedObligation, "recurringId" | "transactionId">): string {
  if (item.recurringId !== null) return `/recurring#schedule-${item.recurringId}`;
  return `/transactions/${item.transactionId}/edit`;
}

// ---------------------------------------------------------------------------
// "Can I afford it?"
// ---------------------------------------------------------------------------

/** "today", "on Saturday" inside the coming week, else "on Nov 27". */
export function onChosenDay(date: string, today: string): string {
  if (date === today) return "today";
  return date <= addDaysISO(today, 6) ? `on ${formatWeekday(date)}` : `on ${formatDateShort(date)}`;
}

export type WhatIfView =
  /** A figure to show, with the sentences under it. */
  | { kind: "figure"; safeToSpend: number; line: string; tightest: string | null }
  /** No figure: a sentence only. */
  | { kind: "message"; line: string };

/** The answer as the panel shows it. `cents` and `date` are what was asked. */
export function whatIfView(answer: WhatIfAnswer, cents: number, date: string, today: string): WhatIfView {
  if (answer.kind === "beyond") {
    return { kind: "message", line: `Sorrel can see as far as ${formatDateShort(answer.horizonEnd)}. Pick a day on or before it.` };
  }
  if (answer.kind === "past") {
    return { kind: "message", line: "Pick today or a day ahead." };
  }

  const amount = formatCurrencyInSentence(cents / 100);
  if (!answer.fits) {
    const when = answer.earliestFit
      ? `From ${formatDateShort(answer.earliestFit)}, there's room.`
      : `It doesn't fit before ${formatDateShort(answer.horizonEnd)}, the furthest Sorrel can see.`;
    return {
      kind: "figure",
      safeToSpend: answer.after.safeToSpend,
      line: `${amount} ${onChosenDay(date, today)} doesn't fit yet. ${when}`,
      tightest: null,
    };
  }

  const items = answer.after.troughItems.map((n) => (n === "This" ? "this" : n));
  const tightest =
    answer.after.troughDate === answer.before.troughDate
      ? `Your tightest day stays ${tightestDay(answer.after.troughDate, today)}.`
      : `Your tightest day would move to ${tightestDay(answer.after.troughDate, today)}${
          items.length > 0 ? `, after ${named(items)}` : ""
        }.`;
  return {
    kind: "figure",
    safeToSpend: answer.after.safeToSpend,
    line: `If you spend ${amount} ${onChosenDay(date, today)}, you'd still have ${formatCurrencyInSentence(answer.after.safeToSpend)} safe to spend.`,
    tightest,
  };
}

function tightestDay(date: string, today: string): string {
  return date === today ? "today" : formatDateWithWeekday(date);
}
