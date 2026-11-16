// What a successful create tells the screen (docs/Motion-and-Delight.md,
// step 3): the toast's words, what "Log again" refills, and whether this was
// the first save of the day. Built where the save is detected, from what
// was just submitted -- never read back from the database.

import { formatCurrency } from "@/lib/format";
import type { LogAgainSource } from "@/lib/logAgain";

export type SavedSummary = {
  /** "Logged · Coffee $5.75", or the first-transaction milestone's own line. */
  message: string;
  /** What "Log again" refills. */
  source: LogAgainSource;
  /** The first save today, from the action's response; never the very first transaction (that has its own line). */
  firstToday: boolean;
};

/** "Logged · Coffee $5.75". The same line for every amount -- never bigger for a big purchase. */
export function loggedMessage(description: string, amount: number): string {
  const text = description.trim();
  const figure = formatCurrency(amount);
  return text ? `Logged · ${text} ${figure}` : `Logged · ${figure}`;
}

export function savedSummary(
  source: LogAgainSource,
  response: { milestone?: { message: string }; firstToday?: boolean } | undefined,
): SavedSummary {
  const milestone = response?.milestone;
  return {
    message: milestone?.message ?? loggedMessage(source.description, source.amount),
    source,
    // The first transaction ever carries its own milestone line; the
    // chip is for an ordinary first save of a day.
    firstToday: Boolean(response?.firstToday) && !milestone,
  };
}
