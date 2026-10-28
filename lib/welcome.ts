import { BLOOM_MS } from "@/lib/bloom";
import { isValidTimeZone, todayInZone } from "@/lib/date";

// The welcome overlay (components/WelcomeBloom.tsx): the bloom in front of
// the app on the first sign-in of the day (placement A) and on a
// successful email confirmation (B). See docs/Goal-Completion.md.
//
// One host, one component: the overlay lives in the ROOT layout only
// (components/WelcomeBloom.tsx), so it is on every page and survives the
// move from /login into the app. Both inputs arrive in one one-shot
// cookie, sorrel_welcome:
//
//   A  "daily:<greeting>", set by login() when it's the user's first
//      sign-in of the day (decided against the date cookie). login() still
//      ends in a server redirect -- the dashboard comes back in the same
//      response, one round trip. The cookie arrives with that response's
//      headers, before the app's scripts; the host, told by the login form
//      that a sign-in is in flight, watches for it and starts the bloom
//      the moment it lands. (A returned value instead cost every sign-in a
//      second round trip: +0.9s on Slow 4G, bloom or not.)
//   B  "confirmed", set by /auth/confirm. The root layout is static, so
//      the server can't read it; the overlay is always in the HTML,
//      hidden, and WELCOME_SCRIPT reveals it before first paint --
//      THEME_SCRIPT's pattern.
//
// The host clears the cookie either way. Cookies, never localStorage or a
// database column: per device, no write on any page load (record_login()
// is the shape this avoids).

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

/**
 * One-shot: "confirmed" (B) or "daily:<greeting>" (A). Readable by the page
 * (not httpOnly). The daily value carries display text -- the user's
 * greeting name -- for at most WELCOME_MAX_AGE_S, and the host clears it
 * on arrival. Named in the privacy policy's cookie paragraph.
 */
export const WELCOME_COOKIE = "sorrel_welcome";
const DAILY_PREFIX = "daily:";

/** The cookie's value for A. */
export function dailyWelcomeValue(greeting: string): string {
  return DAILY_PREFIX + greeting;
}

export type WelcomeCookie = { reason: "confirmed" } | { reason: "daily"; greeting: string };

/**
 * Reads sorrel_welcome out of document.cookie. Next writes the value
 * URI-encoded. Anything unrecognised -- or undecodable -- is no welcome.
 */
export function parseWelcomeCookie(cookieHeader: string): WelcomeCookie | null {
  const raw = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${WELCOME_COOKIE}=`))
    ?.slice(WELCOME_COOKIE.length + 1);
  if (raw === undefined) return null;
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (value === "confirmed") return { reason: "confirmed" };
  if (value.startsWith(DAILY_PREFIX) && value.length > DAILY_PREFIX.length) {
    return { reason: "daily", greeting: value.slice(DAILY_PREFIX.length) };
  }
  return null;
}
/**
 * It only has to survive one navigation. The host clears it on hydration;
 * if hydration never happens, this keeps it from firing on some later load.
 */
export const WELCOME_MAX_AGE_S = 60;

/** The host's element: the one the pre-paint script reveals. */
export const WELCOME_OVERLAY_ID = "welcome-bloom";

/**
 * Runs inline, right after the host's markup and before first paint, on
 * every full page load. Reveals the overlay only for an exact
 * sorrel_welcome=confirmed. Fails CLOSED: anything that throws leaves it
 * hidden -- a missed animation costs nothing; a spurious welcome on a
 * public page is a bug people screenshot. It reveals regardless of the
 * motion preference: B shows under reduced motion (flower at rest); CSS
 * gates only the animation.
 */
export const WELCOME_SCRIPT = `(function(){try{if(/(?:^|;\\s*)${WELCOME_COOKIE}=confirmed(?:;|$)/.test(document.cookie)){var e=document.getElementById(${JSON.stringify(
  WELCOME_OVERLAY_ID,
)});if(e){e.removeAttribute("hidden")}}}catch(e){}})();`;

/**
 * `YYYY-MM-DD` -- the calendar day this browser last showed the opening
 * animation. The date and nothing else: no user id. The cookie is already
 * per browser, so the date answers "today or not"; an id would only
 * distinguish two people sharing a browser, where being wrong costs one
 * missed animation -- not worth a persistent identifier. Read only by the
 * server. Named in the privacy policy's cookie paragraph.
 */
export const WELCOMED_ON_COOKIE = "sorrel_welcomed_on";
/**
 * A week. It only has to tell today from not-today; anything older than
 * yesterday says the same thing as no cookie at all.
 */
export const WELCOMED_ON_MAX_AGE_S = 7 * 24 * 60 * 60;

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

/**
 * The daily welcome's decision, made in the sign-in action: welcome when
 * this browser hasn't shown the animation on the user's current day. A
 * confirmed signup's mark counts, so the two never stack.
 */
export function shouldWelcomeToday(welcomedOn: string | undefined, day: string): boolean {
  return welcomedOn !== day;
}

/**
 * The zone a welcome is keyed to: the user's stored zone, else the zone the
 * browser sent with the form (a brand-new user has no stored zone until
 * TodayProvider reports one), else null -- UTC. Never the server's clock.
 */
export function welcomeZone(storedZone: string | null, browserZone: string | null): string | null {
  return storedZone ?? (browserZone && isValidTimeZone(browserZone) ? browserZone : null);
}

/** The user's calendar day in that zone. */
export function welcomeDay(storedZone: string | null, browserZone: string | null, now: Date): string {
  return todayInZone(welcomeZone(storedZone, browserZone), now);
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
