import { BLOOM_MS } from "@/lib/bloom";
import { todayInZone } from "@/lib/date";

// The welcome overlay (components/WelcomeBloom.tsx): the bloom in front of
// the app on a successful email confirmation. See docs/Goal-Completion.md,
// placement B.

/** The redirect query that says "this load is a confirmed signup". */
export const WELCOME_PARAM = "welcome";
export const WELCOME_CONFIRMED = "confirmed";

export type WelcomeReason = "confirmed";

/**
 * `next` (an in-app path, already safeNext()-checked) with the confirmed
 * welcome added. Only the verifyOtp() success path calls this.
 */
export function withWelcome(next: string): string {
  const url = new URL(next, "http://sorrel.invalid");
  url.searchParams.set(WELCOME_PARAM, WELCOME_CONFIRMED);
  return url.pathname + url.search + url.hash;
}

/** The bloom, then the ~200ms dissolve -- 1.1s, the ceiling. */
export const WELCOME_BLOOM_MS = BLOOM_MS;
export const WELCOME_DISSOLVE_MS = 200;
/** How long the confirmation message stays before it dissolves on its own. */
export const CONFIRMED_HOLD_MS = 2400;

// localStorage, never a database column: a "last welcomed" write on page
// load is the record_login() shape this codebase already removed. Keyed
// per user, so two people sharing a browser are each welcomed once a day.
// The value is the user's calendar day, never a UTC date.
const WELCOMED_PREFIX = "sorrel-welcomed:";

export type WelcomeStorage = Pick<Storage, "getItem" | "setItem">;

/** The day the welcome is keyed to: the user's zone, else the browser's. */
export function welcomeDay(storedZone: string | null, browserZone: string, now: Date): string {
  // A brand-new user has no stored zone until TodayProvider reports one,
  // and null means UTC everywhere else -- the browser's zone is the right
  // stand-in, and is what the stored one becomes on its first sync.
  return todayInZone(storedZone ?? browserZone, now);
}

/**
 * Marks `day` as welcomed for this user. Never throws: a blocked or full
 * storage just means the mark isn't kept. Returns whether it was written.
 */
export function markWelcomed(storage: () => WelcomeStorage, userId: string, day: string): boolean {
  try {
    storage().setItem(WELCOMED_PREFIX + userId, day);
    return true;
  } catch {
    return false;
  }
}

/** The day last welcomed, or undefined when storage can't be read. */
export function readWelcomed(storage: () => WelcomeStorage, userId: string): string | null | undefined {
  try {
    return storage().getItem(WELCOMED_PREFIX + userId);
  } catch {
    return undefined;
  }
}
