import { BLOOM_MS } from "@/lib/bloom";
import { isValidTimeZone, todayInZone } from "@/lib/date";

// The welcome overlay (components/WelcomeBloom.tsx): the bloom in front of
// the app on a successful email confirmation (placement B). See
// docs/Goal-Completion.md.
//
// The reason rides in a one-shot cookie, set by the action that signed the
// user in and read by the authenticated layout on the server -- so the
// overlay is in the first render of the app, never waiting on hydration.
// The overlay's companion (components/SessionFlags.tsx) deletes the
// cookie as it mounts. Cookies, not localStorage and never a database
// column: per device, no write on any page load (record_login() is the
// shape this avoids).

export type WelcomeReason = "confirmed";

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

/** The bloom, then the ~200ms dissolve. */
export const WELCOME_BLOOM_MS = BLOOM_MS;
export const WELCOME_DISSOLVE_MS = 200;
/** How long the confirmation message stays before it dissolves on its own. */
export const CONFIRMED_HOLD_MS = 2400;

export function parseWelcomeReason(value: string | undefined): WelcomeReason | null {
  return value === "confirmed" ? value : null;
}

export function welcomedOnValue(userId: string, day: string): string {
  return `${userId}:${day}`;
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
