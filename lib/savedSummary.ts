// What a successful create tells the screen (docs/Motion-and-Delight.md,
// step 3): the toast's words, what "Log again" refills, and whether this was
// the first save of the day. Built where the save is detected, from what
// was just submitted -- never read back from the database.

import { formatCurrency } from "@/lib/format";
import type { LogAgainSource } from "@/lib/logAgain";
import { claimCelebration } from "@/lib/milestonesCelebrated";
import type { MilestoneId } from "@/lib/milestones";

export type SavedSummary = {
  /** "Logged · Coffee $5.75", or the first-transaction milestone's own line. */
  message: string;
  /** What "Log again" refills. */
  source: LogAgainSource;
  /** The first save today, from the action's response; never the very first transaction (that has its own line). */
  firstToday: boolean;
  /** "Your 100th log": a log milestone this save crossed and this device has not celebrated; otherwise null. */
  milestoneLabel: string | null;
};

/** "Logged · Coffee $5.75". The same line for every amount -- never bigger for a big purchase. */
export function loggedMessage(description: string, amount: number): string {
  const text = description.trim();
  const figure = formatCurrency(amount);
  return text ? `Logged · ${text} ${figure}` : `Logged · ${figure}`;
}

export function savedSummary(
  source: LogAgainSource,
  response:
    | { milestone?: { message: string }; firstToday?: boolean; logMilestone?: { id: MilestoneId; label: string } }
    | undefined,
): SavedSummary {
  const milestone = response?.milestone;
  // Claimed even when the chip is suppressed: it has been celebrated here.
  const crossed = response?.logMilestone;
  const claimed = crossed ? claimCelebration(crossed.id) : false;
  return {
    message: milestone?.message ?? loggedMessage(source.description, source.amount),
    source,
    // The first transaction ever carries its own milestone line; the
    // chip is for an ordinary first save of a day.
    firstToday: Boolean(response?.firstToday) && !milestone,
    // The first log ever already carries "First transaction logged".
    milestoneLabel: crossed && claimed && !(milestone && crossed.id === "log-1") ? crossed.label : null,
  };
}
