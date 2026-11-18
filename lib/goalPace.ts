import { formatCurrencyInSentence } from "@/lib/format";
import { parseLocalDate } from "@/lib/date";

// Goal pace's words (docs/Decide-and-Grow.md, section H). Every figure here
// comes from goal_pace() (migration 72) -- the pace, the bloom month, the
// target month and the monthly amount that would reach it are all worked
// out in SQL. This file only turns them into a sentence; it does no money
// arithmetic.
//
// Never judge (rule 3): no "behind", "off track", "missed" or "late". A
// target date that has passed is no date at all (SQL drops it). Estimates
// say so (rule 4): every pace line reads "At this pace". No exclamation
// marks: these lines carry figures.

export type GoalPaceState = "complete" | "not_enough" | "no_pace" | "pace";

/** One row of goal_pace(), as numbers and ISO dates. */
export type GoalPace = {
  goalId: string;
  followsCard: boolean;
  state: GoalPaceState;
  /** The monthly pace in dollars; null unless state is "pace". */
  pace: number | null;
  /** First day of the bloom month; null unless state is "pace". */
  bloomMonth: string | null;
  /** First day of the target month, only while it's still ahead. */
  targetMonth: string | null;
  onPace: boolean | null;
  /** Dollars a month that would reach the target month, rounded up to $10. */
  neededMonthly: number | null;
};

export type GoalPaceLine = {
  /** The month shown on the calendar; null for the history-only line. */
  month: string | null;
  /** "At this pace, Japan trip blooms in May." */
  headline: string;
  /** "Based on about $350 a month over the last 3 months." */
  basis: string | null;
  /** The target-date sentence, when there's a target month. */
  target: string | null;
};

/** "May", or "May 2028" when the month is a year or more away from today's. */
export function paceMonth(monthISO: string, todayISO: string): string {
  const date = parseLocalDate(monthISO);
  const ahead =
    (Number(monthISO.slice(0, 4)) - Number(todayISO.slice(0, 4))) * 12 +
    (Number(monthISO.slice(5, 7)) - Number(todayISO.slice(5, 7)));
  return date.toLocaleDateString("en-US", ahead >= 12 ? { month: "long", year: "numeric" } : { month: "long" });
}

/**
 * The goal card's pace line, or null when there's nothing to say (a
 * finished goal, or a card that owes the same or more -- no pace, no line).
 * `name` is the goal's name, or the card's for a goal that follows one.
 */
export function goalPaceLine(p: GoalPace, name: string, todayISO: string): GoalPaceLine | null {
  if (p.state === "complete" || p.state === "no_pace") return null;

  if (p.state === "not_enough") {
    return {
      month: null,
      headline: p.followsCard
        ? "A payoff estimate appears after a few months of this card's balances."
        : "Add to it a few more times and Sorrel will estimate when it blooms.",
      basis: null,
      target: null,
    };
  }

  if (p.pace === null || p.bloomMonth === null) return null;

  const bloom = paceMonth(p.bloomMonth, todayISO);
  const headline = p.followsCard
    ? `At this pace, ${name} is paid off in ${bloom}.`
    : `At this pace, ${name} blooms in ${bloom}.`;
  const basis = p.followsCard
    ? `Based on about ${formatCurrencyInSentence(Math.round(p.pace))} a month off the balance over the last 3 months.`
    : `Based on about ${formatCurrencyInSentence(Math.round(p.pace))} a month over the last 3 months.`;

  let target: string | null = null;
  if (p.targetMonth !== null) {
    const by = paceMonth(p.targetMonth, todayISO);
    if (p.onPace) {
      target = `On pace for your ${by} date.`;
    } else if (p.neededMonthly !== null) {
      target = `About ${formatCurrencyInSentence(p.neededMonthly)} a month would ${
        p.followsCard ? "pay it off" : "bloom it"
      } by ${by}.`;
    }
  }

  return { month: p.bloomMonth, headline, basis, target };
}

const STATES: readonly GoalPaceState[] = ["complete", "not_enough", "no_pace", "pace"];

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * A goal_pace() row, or null when its shape is unexpected -- the line is
 * then left out rather than shown wrong.
 */
export function parseGoalPace(row: Record<string, unknown>): GoalPace | null {
  const state = row.state as GoalPaceState;
  if (typeof row.goal_id !== "string" || !STATES.includes(state)) return null;
  const parsed: GoalPace = {
    goalId: row.goal_id,
    followsCard: row.follows_card === true,
    state,
    pace: num(row.pace),
    bloomMonth: iso(row.bloom_month),
    targetMonth: iso(row.target_month),
    onPace: typeof row.on_pace === "boolean" ? row.on_pace : null,
    neededMonthly: num(row.needed_monthly),
  };
  if (state === "pace" && (parsed.pace === null || parsed.bloomMonth === null)) return null;
  return parsed;
}
