import { BLOOM_MS } from "@/lib/bloom";
import { isValidTimeZone, todayInZone } from "@/lib/date";

// The welcome overlay (components/WelcomeBloom.tsx): the bloom in front of
// the app on the first sign-in of the day (placement A) and on a
// successful email confirmation (B). See docs/Goal-Completion.md.
//
// The reason rides in a one-shot cookie, set by the action that signed the
// user in and read by the authenticated layout on the server -- so the
// overlay is in the first render of the app, never waiting on hydration.
// components/SessionFlags.tsx deletes the cookie as the layout mounts.
// Cookies, not localStorage and never a database column: per device, no
// write on any page load (record_login() is the shape this avoids).

/**
 * Placement A, the daily welcome, in one line. Ask two testers in week two
 * whether it still charms; "I've started tapping through it" means turn
 * this off. B (email confirmed) is not behind it.
 */
export const WELCOME_DAILY_ENABLED = true;
/** The bloom, then the ~200ms dissolve -- 1.1s, the ceiling. */
export const WELCOME_BLOOM_MS = BLOOM_MS;
export const WELCOME_DISSOLVE_MS = 200;

export type WelcomeReason = "confirmed" | "daily";

/** One-shot: why to welcome on the next authenticated render. */
export const WELCOME_COOKIE = "sorrel_welcome";
/** Short: an unconsumed welcome must not surface on some later visit. */
export const WELCOME_MAX_AGE_S = 60;

/**
 * `<userid>:<YYYY-MM-DD>` -- the user's calendar day this device last
 * welcomed them. Per user, so a shared browser welcomes each person. Read
 * only by the server.
 */
export const WELCOMED_ON_COOKIE = "sorrel_welcomed_on";
export const WELCOMED_ON_MAX_AGE_S = 400 * 24 * 60 * 60;

/**
 * B only: how long the confirmation message stays before it dissolves on
 * its own (2.4s + the dissolve). Once ever and dismissible, so it can hold
 * long enough to read. The daily gate never uses it: it ends at
 * WELCOME_BLOOM_MS.
 */
export const CONFIRMED_HOLD_MS = 2400;
/**
 * The daily welcome waits for the page behind it, swaying, past the bloom
 * -- but never longer than this. A page that never reports ready must not
 * hold anyone behind a flower.
 */
export const DAILY_READY_TIMEOUT_MS = 8000;

export function parseWelcomeReason(value: string | undefined): WelcomeReason | null {
  return value === "confirmed" || value === "daily" ? value : null;
}

export function welcomedOnValue(userId: string, day: string): string {
  return `${userId}:${day}`;
}

/**
 * The daily welcome's decision, made in the sign-in action: welcome when
 * this device hasn't welcomed this user on this day of theirs. A confirmed
 * signup's mark counts, so the two never stack.
 */
export function shouldWelcomeToday(welcomedOn: string | undefined, userId: string, day: string): boolean {
  return welcomedOn !== welcomedOnValue(userId, day);
}

/**
 * The day a welcome is keyed to: the user's stored zone, else the zone the
 * browser sent with the form (a brand-new user has no stored zone until
 * TodayProvider reports one), else UTC. Never the server's clock zone.
 */
export function welcomeDay(storedZone: string | null, browserZone: string | null, now: Date): string {
  const formZone = browserZone && isValidTimeZone(browserZone) ? browserZone : null;
  return todayInZone(storedZone ?? formZone, now);
}

/** Deletes a one-shot cookie from the browser. */
export function clearCookieScript(name: string): string {
  return `${name}=; Max-Age=0; path=/; SameSite=Lax`;
}

/** The hour (0-23) on the wall clock in `timeZone`; UTC if it's unknown. */
export function hourInZone(timeZone: string | null, now: Date): number {
  const format = (zone: string) =>
    Number(
      new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" })
        .formatToParts(now)
        .find((p) => p.type === "hour")!.value,
    );
  try {
    return format(timeZone ?? "UTC");
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
