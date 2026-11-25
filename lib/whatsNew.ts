import { addDaysISO, todayInZone } from "@/lib/date";
import { RECAP_DAYS } from "@/lib/monthStory";

// The dashboard's "What's new" card: a quiet note about features testers
// were never told about by email (docs/tester-notes/). It is an
// announcement, not a policy-change notice, and is never recorded as one.
//
// Shown for 30 days from the deploy date, then never again, and only to
// people whose account is older than that day. The window is calendar dates
// in the user's day (getToday()), never the process clock. WHATS_NEW_FROM is
// the day this ships (America/New_York): a later deploy than this shortens
// the window, an earlier one lengthens it. Change it, its test and nothing
// else when the push day moves.
//
// This is the second November card. The earlier ones (from 2026-11-16 and
// 2026-11-20, cookies sorrel_whats_new_seen_<date>) are replaced by it; its
// cookie is a different name, so dismissing either never hides this one.

export const WHATS_NEW_FROM = "2026-11-23";
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

/**
 * Whether this account existed before the card's first day, in the user's
 * own zone (the same day getToday() names). Someone who just signed up and
 * went through onboarding doesn't need a list of what's "new". A creation
 * time we can't read is not eligible: better no card than a wrong one.
 */
export function accountExistedBefore(
  createdAt: string | null | undefined,
  timeZone: string | null,
  from: string = WHATS_NEW_FROM,
): boolean {
  if (!createdAt) return false;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  return todayInZone(timeZone, created) < from;
}

export type WhatsNewAction =
  | { kind: "none" }
  | { kind: "href"; href: string }
  /** A hash link to a card's place on the dashboard. */
  | { kind: "card"; href: string }
  | { kind: "runway" }
  | { kind: "yourSorrel" };

export type WhatsNewItem = { id: string; text: string; action: WhatsNewAction };

// Six lines at most, in this order, one sentence or two each. Neutral:
// no exclamation marks.
export const WHATS_NEW_ITEMS: readonly WhatsNewItem[] = [
  {
    id: "recap",
    text: "On December 1st, Sorrel shows a short look back at November, if you logged at least five times.",
    action: { kind: "none" },
  },
  {
    // The tiles are on this page: nothing to open.
    id: "tiles",
    text: "Tap Income or Spending on your dashboard to see exactly what's in it.",
    action: { kind: "none" },
  },
  {
    id: "goals",
    text: "Goals now grow as stems, with leaves at a quarter, halfway and three-quarters.",
    action: { kind: "href", href: "/goals" },
  },
  {
    id: "import",
    text: "Imports get a category for every row, and transfers and card payments come in as transfers, so Safe to Spend may move.",
    action: { kind: "href", href: "/import?from=transactions" },
  },
  {
    id: "budgets",
    text: "Tap a budget to see its transactions. Finished schedules now move to Ended.",
    action: { kind: "href", href: "/budgets" },
  },
  {
    // The plant and its landscape are on this page: nothing to open.
    id: "plant",
    text: "The dashboard plant is now a roselle that opens in the morning and closes at night. Your dashboard now has a little landscape that follows the time of day.",
    action: { kind: "none" },
  },
];

/** The day the November recap stops being offered: after its first RECAP_DAYS days. */
export const RECAP_LINE_LAST_DAY = `2026-12-${String(RECAP_DAYS).padStart(2, "0")}`;

/**
 * The lines to show today. The recap line announces something still to come,
 * so it goes once the recap's own week has passed; the rest stay.
 */
export function whatsNewItems(today: string): readonly WhatsNewItem[] {
  return WHATS_NEW_ITEMS.filter((item) => item.id !== "recap" || today <= RECAP_LINE_LAST_DAY);
}

/** Lines shown before "Show all" on a phone. */
export const WHATS_NEW_PHONE_LINES = 3;
