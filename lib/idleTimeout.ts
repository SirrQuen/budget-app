// Idle sign-out: the client half. Pure, so every rule is unit tested
// (lib/idleTimeout.test.ts); components/IdleTimeout.tsx only wires it to
// the browser. The server half is Supabase Auth's own inactivity timeout
// (dashboard: Auth > Sessions), the backstop for when this JS never runs.
//
// Timestamps, never ticks. The only state is lastActivityAt, compared with
// Date.now() whenever anything happens -- a background tab's throttled
// timer or a laptop that slept for three hours still sees the true
// elapsed time the moment it runs again, rather than resuming a countdown.
//
// Activity means a PERSON: pointer, key, scroll, touch, focus. Never a
// network request, a refetch, or the clock.
//
// Multi-tab: lastActivityAt lives in localStorage, keyed to the session,
// so activity in any tab of that session counts for all of them.
//
// Nothing here writes to the database. Activity tracking that wrote a
// row per page load would be the record_login() pattern again.

// ---------------------------------------------------------------------------
// Durations -- the one place. Override with NEXT_PUBLIC_IDLE_WARNING_SECONDS
// and NEXT_PUBLIC_IDLE_SIGN_OUT_SECONDS (e.g. 30 and 60 to test; restart
// `next dev` after changing them). Both are measured from the last
// activity. An invalid pair falls back to the defaults.
// ---------------------------------------------------------------------------

const DEFAULT_WARNING_MS = 10 * 60_000;
const DEFAULT_SIGN_OUT_MS = 15 * 60_000;

export type IdleConfig = { warningMs: number; signOutMs: number };

export function resolveIdleConfig(warningSeconds: string | undefined, signOutSeconds: string | undefined): IdleConfig {
  const warn = Number(warningSeconds) * 1000;
  const out = Number(signOutSeconds) * 1000;
  const warningMs = warningSeconds && Number.isFinite(warn) && warn > 0 ? warn : DEFAULT_WARNING_MS;
  const signOutMs = signOutSeconds && Number.isFinite(out) && out > 0 ? out : DEFAULT_SIGN_OUT_MS;
  return warningMs < signOutMs ? { warningMs, signOutMs } : { warningMs: DEFAULT_WARNING_MS, signOutMs: DEFAULT_SIGN_OUT_MS };
}

// Literal process.env reads: Next inlines NEXT_PUBLIC_* at build time only
// when written out like this.
export const IDLE_CONFIG: IdleConfig = resolveIdleConfig(
  process.env.NEXT_PUBLIC_IDLE_WARNING_SECONDS,
  process.env.NEXT_PUBLIC_IDLE_SIGN_OUT_SECONDS,
);

/** The DOM events that mean a person is here. Window focus is handled separately (evaluate first). */
export const ACTIVITY_EVENTS = ["pointermove", "pointerdown", "keydown", "scroll", "touchstart", "focusin"] as const;

/** How often a tab may write lastActivityAt -- pointermove fires constantly. */
export const ACTIVITY_WRITE_THROTTLE_MS = 5_000;

export const ACTIVITY_STORAGE_KEY = "sorrel_last_activity";

// ---------------------------------------------------------------------------
// Phase
// ---------------------------------------------------------------------------

export type IdlePhase =
  | { kind: "active" }
  | { kind: "warning"; remainingMs: number }
  | { kind: "expired" };

export function idlePhase(now: number, lastActivityAt: number, config: IdleConfig = IDLE_CONFIG): IdlePhase {
  const idle = Math.max(0, now - lastActivityAt);
  if (idle >= config.signOutMs) return { kind: "expired" };
  if (idle >= config.warningMs) return { kind: "warning", remainingMs: config.signOutMs - idle };
  return { kind: "active" };
}

// ---------------------------------------------------------------------------
// The shared record
// ---------------------------------------------------------------------------

export type SignOutReason = "timeout" | "manual";

export type ActivityRecord = {
  /** The Supabase session (JWT session_id) this timestamp belongs to. */
  sessionId: string;
  at: number;
  /**
   * Set by the tab that signed out, so the session's other tabs follow at
   * once -- and say the same thing: "timeout" shows the reason on /login,
   * "manual" (the modal's "Sign out now") doesn't, because it wasn't one.
   */
  signedOut?: SignOutReason;
};

export function parseActivityRecord(raw: string | null): ActivityRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ActivityRecord>;
    if (typeof v.sessionId !== "string" || typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
    const signedOut = v.signedOut === "timeout" || v.signedOut === "manual" ? v.signedOut : undefined;
    return { sessionId: v.sessionId, at: v.at, ...(signedOut ? { signedOut } : {}) };
  } catch {
    return null;
  }
}

/**
 * The lastActivityAt a tab should hold after reading the shared record.
 * A record from another session is ignored -- a timestamp left behind by
 * an earlier sign-in must never sign out a fresh one. Otherwise the later
 * of the two wins: activity anywhere counts everywhere, and nothing ever
 * moves the clock backwards.
 */
export function mergeActivity(own: number, record: ActivityRecord | null, sessionId: string): number {
  if (!record || record.sessionId !== sessionId) return own;
  return Math.max(own, record.at);
}

/** How another tab of this session signed out, or null if none has. */
export function signedOutElsewhere(record: ActivityRecord | null, sessionId: string): SignOutReason | null {
  return record !== null && record.sessionId === sessionId ? (record.signedOut ?? null) : null;
}

/** Where a tab goes once its session has ended. */
export function signedOutHref(reason: SignOutReason): string {
  return reason === "timeout" ? "/login?reason=timeout" : "/login";
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** "4:58" -- the visible countdown. Rounds up, so it never shows 0:00 before sign-out. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "15 minutes", "1 minute", "45 seconds" -- for the login page's reason. */
export function formatIdleDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

/** What /login?reason=timeout says. Names what happened, so it can't read as a lost session. */
export function timeoutNotice(config: IdleConfig = IDLE_CONFIG): string {
  return `You were signed out after ${formatIdleDuration(config.signOutMs)} of inactivity.`;
}

// Screen readers hear the countdown at intervals, never every second: on
// each whole minute, then at 30 and 10 seconds. The visible text ticks;
// the live region only changes at these marks.
const ANNOUNCE_AT_SECONDS = [30, 10];

/** The live-region text for this many seconds left, or null to leave it unchanged. */
export function countdownAnnouncement(remainingSeconds: number): string | null {
  if (remainingSeconds <= 0) return null;
  if (remainingSeconds % 60 === 0) {
    const m = remainingSeconds / 60;
    return `${m} minute${m === 1 ? "" : "s"} until you're signed out.`;
  }
  if (ANNOUNCE_AT_SECONDS.includes(remainingSeconds)) {
    return `${remainingSeconds} seconds until you're signed out.`;
  }
  return null;
}
