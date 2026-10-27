"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SorrelFlower } from "@/components/SorrelFlower";
import {
  CONFIRMED_HOLD_MS,
  DAILY_READY_TIMEOUT_MS,
  WELCOME_BLOOM_MS,
  WELCOME_CONFIRMED,
  WELCOME_DAILY_ENABLED,
  WELCOME_DISSOLVE_MS,
  WELCOME_PARAM,
  claimDailyWelcome,
  dailyGreeting,
  hourInZone,
  markWelcomed,
  welcomeDay,
  type WelcomeReason,
} from "@/lib/welcome";
import { onPageReady, resetPageReady, setBloomClaimed } from "@/lib/welcomeSignals";
import { consumeFirstInput } from "@/lib/consumeFirstInput";

// bloom: the flower assembling. waiting (daily only): the bloom is done
// but the page behind isn't, so the same flower sways until it is.
type Phase = "bloom" | "waiting" | "dissolving" | "done";

type Decision = { reason: WelcomeReason; greeting: string } | null;

// The daily welcome is the dashboard's: the page that reports ready. Any
// other landing page skips it, without marking the day.
const DAILY_PATH = "/dashboard";

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function decide(userId: string, timeZone: string | null, name: string | null): Decision {
  const url = new URL(window.location.href);
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const now = new Date();
  const day = welcomeDay(timeZone, browserZone, now);

  if (url.searchParams.get(WELCOME_PARAM) === WELCOME_CONFIRMED) {
    // Off the URL at once, so a refresh or a back-and-forward never
    // replays a once-ever moment.
    url.searchParams.delete(WELCOME_PARAM);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    // A force: no day check. But the first bloom of the session marks the
    // day, so the daily welcome doesn't follow it five seconds later.
    markWelcomed(() => window.localStorage, userId, day);
    return { reason: "confirmed", greeting: "Sorrel is yours." };
  }

  if (url.pathname !== DAILY_PATH) return null;
  const play = claimDailyWelcome({
    enabled: WELCOME_DAILY_ENABLED,
    reducedMotion: prefersReducedMotion(),
    storage: () => window.localStorage,
    userId,
    day,
  });
  return play ? { reason: "daily", greeting: dailyGreeting(hourInZone(timeZone ?? browserZone, now), name) } : null;
}

/**
 * The bloom in front of the app (docs/Goal-Completion.md). Mounted by the
 * authenticated layout, above every page's loading state, so the page
 * renders and streams behind it the whole time -- it never waits on, or
 * delays, anything. The flower is the same element start to finish: it
 * shows the mark fully open whatever the hour -- a greeting, not the fold.
 *
 * "daily" (A): the first dashboard load of the user's day. A gate: it
 * plays to completion and no input dismisses it. The dashboard's request
 * is already in flight behind it -- that request is what rendered this --
 * so it costs max(bloom, load), never bloom + load. If the page isn't
 * ready when the bloom ends, the same flower sways until it is
 * (components/WelcomeReady.tsx says so), then dissolves. Reduced motion
 * skips it entirely. Behind WELCOME_DAILY_ENABLED.
 *
 * "confirmed" (B): a successful email confirmation, signalled by
 * /auth/confirm's redirect (?welcome=confirmed). Once ever, so it bypasses
 * the day check, but it marks the day as welcomed. Any input dismisses it
 * at once, and that input is consumed: the click or key that dismisses
 * it does nothing else. Under reduced motion the flower arrives open and the message
 * appears unchanged -- here the message is the point, not decoration.
 *
 * On a load where either plays, the dashboard mark's sign-in fold doesn't.
 */
export function WelcomeBloom({
  userId,
  timeZone,
  name,
}: {
  userId: string;
  /** settings.timezone; null until the browser has reported one. */
  timeZone: string | null;
  /** greetingName(): preferred name, else first name, else null. */
  name: string | null;
}) {
  const [decided, setDecided] = useState<Decision>(null);
  const [phase, setPhase] = useState<Phase>("done");
  const [ready, setReady] = useState(false);

  // Decided once per mount -- the layout persists across client
  // navigations -- and held in a ref, because deciding has side effects
  // (the URL, the day mark) that StrictMode's re-run must not repeat.
  const decision = useRef<Decision | undefined>(undefined);

  // A layout effect, so the decision is made before the first paint after
  // hydration and before DayNightMark's first frame reads it. The page's
  // ready marker is a passive effect, so it always lands after the reset.
  useLayoutEffect(() => {
    if (decision.current === undefined) {
      resetPageReady();
      decision.current = decide(userId, timeZone, name);
    }
    const current = decision.current;
    setBloomClaimed(current !== null);
    if (current === null) return;

    const unsubscribe = current.reason === "daily" ? onPageReady(() => setReady(true)) : () => {};
    // The decision and its side effects are synchronous; only the render
    // waits a frame, as GoalMeter's does.
    const frame = requestAnimationFrame(() => {
      setDecided(current);
      setPhase("bloom");
    });
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- decided once, on mount
  }, []);

  const reason = decided?.reason;

  // It dissolves on its own. Daily: when the bloom has played AND the page
  // is ready -- whichever is later. Confirmed: after a reading hold.
  useEffect(() => {
    if (phase === "bloom") {
      const timer = setTimeout(
        () => setPhase(reason === "daily" ? "waiting" : "dissolving"),
        reason === "daily" ? WELCOME_BLOOM_MS : CONFIRMED_HOLD_MS,
      );
      return () => clearTimeout(timer);
    }
    if (phase === "waiting" && ready) {
      const frame = requestAnimationFrame(() => setPhase("dissolving"));
      return () => cancelAnimationFrame(frame);
    }
    if (phase === "dissolving") {
      const timer = setTimeout(() => setPhase("done"), prefersReducedMotion() ? 0 : WELCOME_DISSOLVE_MS);
      return () => clearTimeout(timer);
    }
  }, [phase, reason, ready]);

  // Never trapped behind a flower: a page that never reports ready still
  // lets the daily welcome go.
  useEffect(() => {
    if (reason !== "daily") return;
    const timer = setTimeout(() => setReady(true), DAILY_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [reason]);

  // Confirmed only -- the daily welcome is a gate. Any input dismisses it
  // instantly -- and is consumed, not passed through: a click on a dimmed
  // overlay can't see what it would hit. First input dismisses, second
  // acts (lib/consumeFirstInput.ts).
  useEffect(() => {
    if (reason !== "confirmed" || phase === "done") return;
    return consumeFirstInput(window, () => setPhase("done"));
  }, [reason, phase]);

  if (phase === "done" || decided === null) return null;

  return (
    <div
      role="status"
      className={`welcome-bloom fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-page px-4 text-center ${
        phase === "dissolving" ? "welcome-bloom--out" : ""
      }`}
    >
      {/* One element throughout: the bloom's class stays on, and the sway
          is added beside it, so there's no flash of another component. */}
      <SorrelFlower size={120} state="bloom" swaying={phase === "waiting"} />
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold text-ink">{decided.greeting}</h2>
        {reason === "confirmed" ? (
          <p className="text-base text-ink-secondary">You&rsquo;re signed in and ready to go.</p>
        ) : null}
      </div>
    </div>
  );
}
