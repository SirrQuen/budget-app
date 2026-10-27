import { daysBetweenInclusive, parseLocalDate } from "@/lib/date";
import { formatCurrency } from "@/lib/format";

// What Sorrel says when a goal is completed (docs/Goal-Completion.md, D).
// Three parts, every time: the headline names the goal in the user's own
// words; one line with the real figure and one real detail; then what
// happens next. One treatment for every size of goal. No exclamation
// marks, no emoji, nothing about pace the user is behind on.
//
// The "$340 a month you were sending to this card" line is NOT here: a
// recurring schedule can't be tied to a goal with confidence (there is no
// goalid on recurring_transactions, and goals.monthly_contribution is a
// plan the user typed, not a schedule). The spec says drop the line
// rather than name a wrong figure, so it's dropped until linked goals
// give it a real relationship to read.

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
};

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
