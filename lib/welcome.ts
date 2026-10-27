import { BLOOM_MS } from "@/lib/bloom";
import { todayInZone } from "@/lib/date";

// The welcome overlay (components/WelcomeBloom.tsx): the bloom in front of
// the app on the first sign-in of the day (placement A) and on a
// successful email confirmation (B). See docs/Goal-Completion.md.

/**
 * Placement A, the daily welcome, in one line. Ask two testers in week two
 * whether it still charms; "I've started tapping through it" means turn
 * this off. B (email confirmed) is not behind it.
 */
export const WELCOME_DAILY_ENABLED = true;
/** The bloom, then the ~200ms dissolve -- 1.1s, the ceiling. */
export const WELCOME_BLOOM_MS = BLOOM_MS;
export const WELCOME_DISSOLVE_MS = 200;

/** The redirect query that says "this load is a confirmed signup". */
export const WELCOME_PARAM = "welcome";
export const WELCOME_CONFIRMED = "confirmed";

export type WelcomeReason = "confirmed" | "daily";

/**
 * `next` (an in-app path, already safeNext()-checked) with the confirmed
 * welcome added. Only the verifyOtp() success path calls this.
 */
export function withWelcome(next: string): string {
  const url = new URL(next, "http://sorrel.invalid");
  url.searchParams.set(WELCOME_PARAM, WELCOME_CONFIRMED);
  return url.pathname + url.search + url.hash;
}

/** How long the confirmation message stays before it dissolves on its own. */
export const CONFIRMED_HOLD_MS = 2400;
/**
 * The daily welcome waits for the page behind it, swaying, past the bloom
 * -- but never longer than this. A page that never reports ready must not
 * hold anyone behind a flower.
 */
export const DAILY_READY_TIMEOUT_MS = 8000;

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

/**
 * Whether the daily welcome plays, and if it does, marks the day -- at the
 * START, so a refresh 400ms in doesn't replay it. Every failure means
 * don't play: storage that can't be read, or a mark that can't be kept
 * (which would otherwise bloom on every single sign-in).
 */
export function claimDailyWelcome({
  enabled,
  reducedMotion,
  storage,
  userId,
  day,
}: {
  enabled: boolean;
  /** WCAG: reduced motion skips the daily welcome entirely. */
  reducedMotion: boolean;
  storage: () => WelcomeStorage;
  userId: string;
  day: string;
}): boolean {
  if (!enabled || reducedMotion) return false;
  const last = readWelcomed(storage, userId);
  if (last === undefined || last === day) return false;
  return markWelcomed(storage, userId, day);
}

/** The hour (0-23) on the wall clock in `timeZone`; UTC if it's unknown. */
export function hourInZone(timeZone: string, now: Date): number {
  const format = (zone: string) =>
    Number(
      new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" })
        .formatToParts(now)
        .find((p) => p.type === "hour")!.value,
    );
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}

/**
 * "Good morning, Matt." -- a name and nothing else: no figures, no counts.
 * With no name (greetingName() is null), no name at all; never "there".
 */
export function dailyGreeting(hour: number, name: string | null): string {
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return name ? `Good ${part}, ${name}.` : `Good ${part}.`;
}
