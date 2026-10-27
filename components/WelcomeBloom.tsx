"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { SorrelFlower } from "@/components/SorrelFlower";
import {
  CONFIRMED_HOLD_MS,
  DAILY_READY_TIMEOUT_MS,
  WELCOME_BLOOM_MS,
  WELCOME_DISSOLVE_MS,
  type WelcomeReason,
} from "@/lib/welcome";
import { onPageReady, resetPageReady } from "@/lib/welcomeSignals";
import { consumeFirstInput } from "@/lib/consumeFirstInput";

// bloom: the flower assembling. waiting (daily only): the bloom is done
// but the page behind isn't, so the same flower sways until it is.
type Phase = "bloom" | "waiting" | "dissolving" | "done";

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The bloom in front of the app (docs/Goal-Completion.md). The
 * authenticated layout renders it from the server's read of the one-shot
 * welcome cookie, before -- and independent of -- the app's data, so it is
 * in the first render: in the initial HTML on a full load, in the first
 * commit on a client navigation. Nothing waits on hydration to show it.
 * The flower is one element start to finish, fully open whatever the hour
 * -- a greeting, not the day/night fold.
 *
 * "daily" (A): the first sign-in of the user's day (login() queued it). A
 * gate: it plays to completion and no input dismisses it. The page streams
 * in behind it the whole time, so it costs max(bloom, load), never bloom +
 * load. If the page isn't ready when the bloom ends, the same flower sways
 * until it is (components/WelcomeReady.tsx says so), then dissolves.
 * Reduced motion skips it entirely -- hidden by CSS from the first paint
 * (.welcome-bloom--gate), gone at mount.
 *
 * "confirmed" (B): a successful email confirmation (/auth/confirm queued
 * it). Any input dismisses it at once, and that input is consumed: the
 * click or key that dismisses it does nothing else. It dissolves on its
 * own. Under reduced motion the flower arrives open and the message
 * appears unchanged -- here the message is the point, not decoration.
 *
 * Props are read once: the layout can re-render (a revalidation) after the
 * cookie is gone, and that must neither replay nor cut short the overlay
 * already showing.
 */
export function WelcomeBloom({
  reason: initialReason,
  greeting: initialGreeting,
}: {
  reason: WelcomeReason | null;
  /** The daily greeting, resolved on the server; unused for "confirmed". */
  greeting: string | null;
}) {
  const [reason] = useState(initialReason);
  const [greeting] = useState(initialGreeting);
  const [phase, setPhase] = useState<Phase>(initialReason ? "bloom" : "done");
  const [ready, setReady] = useState(false);

  // Before the page behind reports ready (a passive effect, so always
  // after this). Reduced motion ends the daily gate here; CSS already kept
  // it from ever painting.
  useLayoutEffect(() => {
    if (reason !== "daily") return;
    resetPageReady();
    if (prefersReducedMotion()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reduced motion skips the gate before paint
      setPhase("done");
      return;
    }
    return onPageReady(() => setReady(true));
  }, [reason]);

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

  if (phase === "done" || reason === null) return null;

  return (
    <div
      role="status"
      className={`welcome-bloom fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-page px-4 text-center ${
        reason === "daily" ? "welcome-bloom--gate" : ""
      } ${phase === "dissolving" ? "welcome-bloom--out" : ""}`}
    >
      {/* One element throughout: the bloom's class stays on, and the sway
          is added beside it, so there's no flash of another component. */}
      <SorrelFlower size={120} state="bloom" swaying={phase === "waiting"} />
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold text-ink">
          {reason === "confirmed" ? "Sorrel is yours." : greeting}
        </h2>
        {reason === "confirmed" ? (
          <p className="text-base text-ink-secondary">You&rsquo;re signed in and ready to go.</p>
        ) : null}
      </div>
    </div>
  );
}
