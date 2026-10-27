"use client";

import { useEffect, useRef, useState } from "react";
import { SorrelFlower } from "@/components/SorrelFlower";
import { CONFIRMED_HOLD_MS, WELCOME_DISSOLVE_MS, type WelcomeReason } from "@/lib/welcome";
import { consumeFirstInput } from "@/lib/consumeFirstInput";

type Phase = "bloom" | "dissolving" | "done";

// How long the overlay has already been on screen. It is in the server's
// HTML, so it paints -- and the bloom starts -- before React hydrates; a
// timer started at hydration would add that whole gap to every hold (seen
// on dev: 2.6s became 2.9-3.3s). The bloom's own animation started at the
// first paint, so the timeline knows. 0 with no animation (reduced
// motion) -- then there's nothing to measure, and nothing animating.
function onScreenMs(overlay: HTMLElement | null): number {
  const anim = overlay?.querySelector(".sorrel-flower__leaf")?.getAnimations()[0];
  const now = document.timeline.currentTime;
  if (!anim || anim.startTime === null || typeof now !== "number" || typeof anim.startTime !== "number") return 0;
  return Math.max(0, now - anim.startTime);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The bloom in front of the app (docs/Goal-Completion.md). The
 * authenticated layout renders it from the server's read of the one-shot
 * welcome cookie, before -- and independent of -- the app's data, so it is
 * in the first render: in the initial HTML on a full load, in the first
 * commit on a client navigation. Nothing waits on hydration to show it.
 *
 * "confirmed" (B): a successful email confirmation (/auth/confirm queued
 * it). Any input dismisses it at once, and that input is consumed: the
 * click or key that dismisses it does nothing else. It dissolves on its
 * own. Under reduced motion the flower arrives open and the message
 * appears unchanged -- here the message is the point, not decoration.
 *
 * `reason` is read once: the layout can re-render (a revalidation) after
 * the cookie is gone, and that must neither replay nor cut short the
 * overlay already showing.
 */
export function WelcomeBloom({ reason }: { reason: WelcomeReason | null }) {
  const [shown] = useState(reason);
  const [phase, setPhase] = useState<Phase>(reason ? "bloom" : "done");
  const overlayRef = useRef<HTMLDivElement>(null);

  // It dissolves on its own.
  useEffect(() => {
    if (phase === "bloom") {
      const timer = setTimeout(
        () => setPhase("dissolving"),
        Math.max(0, CONFIRMED_HOLD_MS - onScreenMs(overlayRef.current)),
      );
      return () => clearTimeout(timer);
    }
    if (phase === "dissolving") {
      const timer = setTimeout(() => setPhase("done"), prefersReducedMotion() ? 0 : WELCOME_DISSOLVE_MS);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  // Any input dismisses it instantly -- and is consumed, not passed
  // through: a click on a dimmed overlay can't see what it would hit.
  // First input dismisses, second acts (lib/consumeFirstInput.ts).
  useEffect(() => {
    if (phase === "done") return;
    return consumeFirstInput(window, () => setPhase("done"));
  }, [phase]);

  if (phase === "done" || shown === null) return null;

  return (
    <div
      ref={overlayRef}
      role="status"
      className={`welcome-bloom fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-page px-4 text-center ${
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
