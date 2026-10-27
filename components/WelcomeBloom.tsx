"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SorrelFlower } from "@/components/SorrelFlower";
import {
  CONFIRMED_HOLD_MS,
  WELCOME_CONFIRMED,
  WELCOME_DISSOLVE_MS,
  WELCOME_PARAM,
  markWelcomed,
  welcomeDay,
  type WelcomeReason,
} from "@/lib/welcome";
import { setBloomClaimed } from "@/lib/welcomeSignals";

type Phase = "bloom" | "dissolving" | "done";

const INPUT_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function decide(userId: string, timeZone: string | null): WelcomeReason | null {
  const url = new URL(window.location.href);
  if (url.searchParams.get(WELCOME_PARAM) !== WELCOME_CONFIRMED) return null;

  // Off the URL at once, so a refresh or a back-and-forward never replays
  // a once-ever moment.
  url.searchParams.delete(WELCOME_PARAM);
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);

  // The first bloom of the session marks the day, so the daily welcome
  // doesn't follow it five seconds later.
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  markWelcomed(() => window.localStorage, userId, welcomeDay(timeZone, browserZone, new Date()));
  return "confirmed";
}

/**
 * The bloom in front of the app (docs/Goal-Completion.md). Mounted by the
 * authenticated layout, above every page's loading state, so the page
 * renders and streams behind it the whole time -- it never waits on, or
 * delays, anything.
 *
 * "confirmed": a successful email confirmation, signalled by
 * /auth/confirm's redirect (?welcome=confirmed). Once ever, so it bypasses
 * the day check, but it marks the day as welcomed. Any input dismisses it
 * at once, and it never takes the click: the overlay lets pointer events
 * through. Under reduced motion the flower arrives open and the message
 * appears unchanged -- here the message is the point, not decoration.
 *
 * On a load where it plays, the dashboard mark's sign-in fold doesn't.
 */
export function WelcomeBloom({
  userId,
  timeZone,
}: {
  userId: string;
  /** settings.timezone; null until the browser has reported one. */
  timeZone: string | null;
}) {
  const [reason, setReason] = useState<WelcomeReason | null>(null);
  const [phase, setPhase] = useState<Phase>("done");

  // Decided once per mount -- the layout persists across client
  // navigations -- and held in a ref, because deciding has side effects
  // (the URL, the day mark) that StrictMode's re-run must not repeat.
  const decision = useRef<WelcomeReason | null | undefined>(undefined);

  // A layout effect, so the decision is made before the first paint after
  // hydration and before DayNightMark's first frame reads it.
  useLayoutEffect(() => {
    if (decision.current === undefined) {
      decision.current = decide(userId, timeZone);
    }
    const decided = decision.current;
    setBloomClaimed(decided !== null);
    if (decided === null) return;

    // The decision and its side effects are synchronous; only the render
    // waits a frame, as GoalMeter's does.
    const frame = requestAnimationFrame(() => {
      setReason(decided);
      setPhase("bloom");
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- decided once, on mount
  }, []);

  // It dissolves on its own.
  useEffect(() => {
    if (phase === "bloom") {
      const timer = setTimeout(() => setPhase("dissolving"), CONFIRMED_HOLD_MS);
      return () => clearTimeout(timer);
    }
    if (phase === "dissolving") {
      const timer = setTimeout(() => setPhase("done"), prefersReducedMotion() ? 0 : WELCOME_DISSOLVE_MS);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  // Any input dismisses it instantly. Listening on window, passive, and
  // never preventing the default: the click or key still does its job.
  useEffect(() => {
    if (phase === "done") return;
    const dismiss = () => setPhase("done");
    for (const type of INPUT_EVENTS) window.addEventListener(type, dismiss, { passive: true });
    return () => {
      for (const type of INPUT_EVENTS) window.removeEventListener(type, dismiss);
    };
  }, [phase]);

  if (phase === "done" || reason === null) return null;

  return (
    <div
      role="status"
      className={`welcome-bloom pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-page px-4 text-center ${
        phase === "dissolving" ? "welcome-bloom--out" : ""
      }`}
    >
      <SorrelFlower size={120} state="bloom" />
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold text-ink">Sorrel is yours.</h2>
        <p className="text-base text-ink-secondary">You&rsquo;re signed in and ready to go.</p>
      </div>
    </div>
  );
}
