import { daysBetweenInclusive, parseLocalDate } from "@/lib/date";
import { formatCurrency } from "@/lib/format";

// What Sorrel says when a goal is completed (docs/Goal-Completion.md, D).
// Three parts, every time: the headline names the goal in the user's own
// words; one line with the real figure and one real detail; then what
// happens next. One treatment for every size of goal. No exclamation
// marks, no emoji, nothing about pace the user is behind on.
//
// The part only Sorrel can say (docs/Goal-Completion.md): the recurring
// transfers still feeding a goal that's now done aren't committed to
// anything. Built from the schedule link (recurring_transactions.goalid,
// migration 82) by lib/goalCompletionCheck.ts -- a goal following a card
// can't be fed by a schedule, so it never gets the line. Each schedule is
// named with its own amount and cadence; no monthly total is made from
// frequencies (docs/Goals-and-Import.md, ruling 4).

export type GoalCompletionFacts = {
  goalId: string;
  goalName: string;
  goalType: string;
  /** v_goal_progress.contributed_amount -- summed in SQL. */
  contributed: number;
  targetAmount: number;
  targetDate: string | null;
  firstContributionDate: string | null;
  /** The user's calendar day the action ran (getToday()). */
  completedOn: string;
};

/** What the panel's primary action does. */
export type CompletionNext = "start-another" | "set-next";

export type GoalCompletion = {
  goalId: string;
  headline: string;
  figure: string;
  /** A sentence on what happens next, when there's one worth saying. */
  nextLine: string | null;
  next: CompletionNext;
  primaryLabel: string;
  /**
   * The schedules still feeding the goal, and the sentence about them;
   * null when none does. Each gets its own Stop / Redirect / Keep.
   */
  freed?: FreedUp | null;
};

/** The recurring transfers a completed goal no longer needs. */
export type FreedUp = {
  line: string;
  schedules: { id: string; label: string }[];
  /** Goals a schedule can be redirected to: active, uncompleted, manual, not this one. */
  redirectTo: { id: string; name: string }[];
};

/**
 * "Weekly $50 (fixed) to Savings isn't committed to anything now." -- or,
 * for several, "... and ... aren't committed to anything now." Names the
 * amounts, never a generality. null with nothing to name.
 */
export function freedUpLine(labels: readonly string[]): string | null {
  if (labels.length === 0) return null;
  if (labels.length === 1) return `${labels[0]} isn't committed to anything now.`;
  const list = `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `${list} aren't committed to anything now.`;
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

function count(n: number, unit: string): string {
  const number = n < WORDS.length ? WORDS[n] : String(n);
  return `${number} ${unit}${n === 1 ? "" : "s"}`;
}

function daysFrom(fromISO: string, toISO: string): number {
  return daysBetweenInclusive(fromISO, toISO) - 1;
}

/** "four months", "seven weeks", "nine days"; null under two days. */
export function duration(days: number): string | null {
  if (days < 2) return null;
  if (days < 14) return count(days, "day");
  if (days < 60) return count(Math.round(days / 7), "week");
  const months = Math.round(days / 30.44);
  if (months < 24) return count(months, "month");
  return count(Math.round(months / 12), "year");
}

/** "seven weeks ahead of your date" -- only ever ahead, never behind. */
export function aheadOfDate(completedOn: string, targetDate: string | null): string | null {
  if (targetDate === null || completedOn >= targetDate) return null;
  const days = daysFrom(completedOn, targetDate);
  const span = days >= 14 ? count(Math.round(days / 7), "week") : count(days, "day");
  return `${span} ahead of your date`;
}

function monthName(dateISO: string, completedOn: string): string {
  const date = parseLocalDate(dateISO);
  const sameYear = dateISO.slice(0, 4) === completedOn.slice(0, 4);
  return date.toLocaleDateString("en-US", sameYear ? { month: "long" } : { month: "long", year: "numeric" });
}

export function completionCopy(facts: GoalCompletionFacts): GoalCompletion {
  const amount = formatCurrency(facts.contributed);
  const span = facts.firstContributionDate
    ? duration(daysFrom(facts.firstContributionDate, facts.completedOn))
    : null;
  const ahead = aheadOfDate(facts.completedOn, facts.targetDate);

  if (facts.goalType === "Debt Payoff") {
    const since = facts.firstContributionDate
      ? ` since ${monthName(facts.firstContributionDate, facts.completedOn)}`
      : "";
    return {
      goalId: facts.goalId,
      headline: `${facts.goalName} is paid off.`,
      figure: `${amount} cleared${since}${ahead ? ` — ${ahead}` : ""}.`,
      nextLine: null,
      next: "start-another",
      primaryLabel: "Start another goal",
    };
  }

  // A milestone, not an ending: nothing here may say the work is done.
  if (facts.goalType === "Retirement") {
    return {
      goalId: facts.goalId,
      headline: `${facts.goalName}: you’ve reached ${formatCurrency(facts.targetAmount)}.`,
      figure: span ? `${amount} saved, ${span} in.` : `${amount} saved.`,
      nextLine: "Your next milestone is yours to set.",
      next: "set-next",
      primaryLabel: "Set the next one",
    };
  }

  const detail = ahead ?? (span ? `over ${span}` : null);
  return {
    goalId: facts.goalId,
    headline: `${facts.goalName} — done.`,
    figure: detail ? `${amount} set aside ${ahead ? `— ${detail}` : detail}.` : `${amount} set aside.`,
    nextLine: null,
    next: "start-another",
    primaryLabel: "Start another goal",
  };
}
