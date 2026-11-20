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
// This is the November card. The first one (from 2026-11-16, cookie
// sorrel_whats_new_seen_2026-11-16) is replaced by it; its cookie is a
// different name, so dismissing that one never hides this one.

export const WHATS_NEW_FROM = "2026-11-20";
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
  /** The Coming up card: a hash link to its place on the dashboard. */
  | { kind: "card"; href: string }
  | { kind: "runway" }
  | { kind: "yourSorrel" };

export type WhatsNewItem = { id: string; text: string; action: WhatsNewAction };

/** The id the dashboard gives Coming up's card (DashboardSections). */
export const COMING_UP_CARD_HREF = "#dash-card-upcoming";

// Six lines at most, in this order, one sentence or two each. Neutral:
// no exclamation marks.
export const WHATS_NEW_ITEMS: readonly WhatsNewItem[] = [
  {
    id: "recap",
    text: "Your month in review arrives December 1st: a short look back at November.",
    action: { kind: "none" },
  },
  {
    id: "runway",
    text: "See your runway on Safe to Spend, or ask “What if I spend…” before you buy.",
    action: { kind: "runway" },
  },
  {
    id: "goals",
    text: "Goals now show when they’ll bloom. Link a transaction to a goal, or let a debt goal follow your card.",
    action: { kind: "href", href: "/goals" },
  },
  {
    id: "coming-up",
    text: "Coming up has a timeline view, and Log again repeats any transaction in two taps.",
    action: { kind: "card", href: COMING_UP_CARD_HREF },
  },
  {
    id: "your-sorrel",
    text: "Your Sorrel keeps your milestones, and a small visitor stops by each part of the day.",
    action: { kind: "yourSorrel" },
  },
  {
    id: "privacy",
    text: "Our privacy policy was clarified, and you can find us on TikTok, Instagram and Facebook.",
    action: { kind: "href", href: "/privacy" },
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
