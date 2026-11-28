// The schedules that feed a goal (recurring_transactions.goalid, migration
// 82; docs/Goals-and-Import.md Part A and its rulings): how they're named
// in a sentence, and the two questions linking one can raise. Pure, so the
// recurring form, the goal form, the goals page and the transaction editor
// all word them the same way.
//
// No monthly figure is ever made from a schedule's frequency (ruling 4):
// each schedule shows its own amount and cadence, and what a goal gets this
// month is the projection's own occurrences ("Scheduled this month",
// GoalScheduled in lib/safeToSpendProjection.ts).

import { amountBasisLabel, type AmountBasis } from "@/lib/amountBasis";
import { formatCurrencyInSentence } from "@/lib/format";

/** The fields of a schedule these sentences read. */
export type ScheduleFacts = {
  id: string;
  description: string;
  amount: number;
  basis: AmountBasis;
  frequency: string;
  intervalCount: number;
  accountId: string;
  toAccountId: string;
  toAccountName: string;
};

/** "Weekly", "Every 2 weeks", "Monthly" -- the cadence as one word or phrase. */
export function cadenceWord(frequency: string, intervalCount = 1): string {
  switch (frequency) {
    case "Daily":
      return intervalCount > 1 ? `Every ${intervalCount} days` : "Daily";
    case "Weekly":
      return intervalCount > 1 ? `Every ${intervalCount} weeks` : "Weekly";
    case "Biweekly":
      return "Every 2 weeks";
    case "Monthly":
      return intervalCount > 1 ? `Every ${intervalCount} months` : "Monthly";
    case "Quarterly":
      return "Quarterly";
    case "Yearly":
      return "Yearly";
    default:
      return frequency;
  }
}

/**
 * "Weekly $50 (fixed) to Savings" -- a schedule named by what it does. The
 * amount carries what it rests on, as every upcoming amount does.
 */
export function scheduleLabel(s: ScheduleFacts): string {
  return `${cadenceWord(s.frequency, s.intervalCount)} ${formatCurrencyInSentence(s.amount)} (${amountBasisLabel(s.basis)}) to ${s.toAccountName}`;
}

/**
 * The schedule form's hint when the chosen goal already has schedules:
 * "Emergency fund is also fed by Weekly $50 (fixed) to Savings." Information,
 * not a warning. null when nothing else feeds it.
 */
export function alsoFedByHint(goalName: string, others: readonly ScheduleFacts[]): string | null {
  if (others.length === 0) return null;
  return `${goalName} is also fed by ${joinAnd(others.map(scheduleLabel))}.`;
}

/** "This schedule will feed Beach trip instead of Emergency fund." -- a move, said on the schedule. */
export function moveLine(toGoalName: string, fromGoalName: string): string {
  return `This schedule will feed ${toGoalName} instead of ${fromGoalName}.`;
}

/** Unlinking from the schedule form: said, never silent. */
export function stopFeedingLine(fromGoalName: string): string {
  return `This schedule will stop feeding ${fromGoalName}. It keeps running.`;
}

/**
 * A schedule already feeding the goal that this one repeats -- same amount,
 * frequency and accounts -- so linking would likely count one transfer
 * twice. Asked, never merged (Part A rule 4). undefined when there's none.
 */
export function duplicateOf(
  candidate: Pick<ScheduleFacts, "amount" | "frequency" | "intervalCount" | "accountId" | "toAccountId"> & { id?: string },
  feeding: readonly ScheduleFacts[],
): ScheduleFacts | undefined {
  const cents = (n: number) => Math.round(n * 100);
  return feeding.find(
    (s) =>
      s.id !== candidate.id &&
      cents(s.amount) === cents(candidate.amount) &&
      s.frequency === candidate.frequency &&
      s.intervalCount === candidate.intervalCount &&
      s.accountId === candidate.accountId &&
      s.toAccountId === candidate.toAccountId,
  );
}

/** "Weekly $50 (fixed) to Savings already feeds this goal. Add this one as well?" */
export function duplicateQuestion(existing: ScheduleFacts): string {
  return `${scheduleLabel(existing)} already feeds this goal. Add this one as well?`;
}

/**
 * The transaction editor, when one occurrence's goal differs from its
 * schedule's: "Only this payment. Weekly $50 still feeds Emergency fund."
 * (ruling 10). The schedule's link doesn't move.
 */
export function onlyThisPaymentLine(scheduleName: string, scheduleGoalName: string): string {
  return `Only this payment. ${scheduleName} still feeds ${scheduleGoalName}.`;
}

/** The goal page's offer for confirmations made before they were linked (ruling 1). */
export function uncountedOffer(count: number, scheduleName: string): string {
  return count === 1
    ? `1 earlier transfer from ${scheduleName} isn't counted toward this goal. Count it?`
    : `${count} earlier transfers from ${scheduleName} aren't counted toward this goal. Count them?`;
}

/** The goal delete confirmation's line: "2 schedules feed this goal. They'll keep running, unlinked." */
export function deleteGoalSchedulesLine(count: number): string | null {
  if (count === 0) return null;
  return count === 1
    ? "1 schedule feeds this goal. It'll keep running, unlinked."
    : `${count} schedules feed this goal. They'll keep running, unlinked.`;
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
