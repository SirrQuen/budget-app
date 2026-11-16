import { addDaysISO } from "@/lib/date";

// The dashboard's "What's new" card: a quiet note about features testers
// were never told about by email (docs/tester-notes/). It is an
// announcement, not a policy-change notice, and is never recorded as one.
//
// Shown for 30 days from the deploy date, then never again. The window is
// calendar dates in the user's day (getToday()), never the process clock.
// WHATS_NEW_FROM is the day this ships (America/New_York, 2026-11-16): a
// later deploy than this shortens the window, an earlier one lengthens it.

export const WHATS_NEW_FROM = "2026-11-16";
export const WHATS_NEW_DAYS = 30;

/** Last day the card shows. */
export const WHATS_NEW_LAST_DAY = addDaysISO(WHATS_NEW_FROM, WHATS_NEW_DAYS - 1);

/**
 * The "Got it" cookie is named for this card's start date, so a later
 * What's new card (a different WHATS_NEW_FROM) is never hidden by this one.
 */
export const WHATS_NEW_COOKIE = `sorrel_whats_new_seen_${WHATS_NEW_FROM}`;

export function whatsNewVisible(today: string, seen: boolean): boolean {
  if (seen) return false;
  return today >= WHATS_NEW_FROM && today <= WHATS_NEW_LAST_DAY;
}

// One short line each. Wording follows docs/tester-notes/.
export const WHATS_NEW_LINES: readonly string[] = [
  "A new question when you log something dated before your balance: was it already included? You choose, and nothing is guessed.",
  "Budgets carry from month to month, so you don't enter them again each month.",
  "Is this the same bill? Sorrel asks when an entry and a schedule look like one bill, so it counts once.",
  "Export from Transactions follows your filters.",
  "Import transactions from a CSV file: tap Import on Transactions or any account. Your file is read on your device and never uploaded.",
  "Rearrange your dashboard by dragging a card's grip.",
  "Tap any account to see its transactions.",
];

export const WHATS_NEW_PRIVACY_LINE = "Our privacy policy was updated on November 14 to cover imports.";
