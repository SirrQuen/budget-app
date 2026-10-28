"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SorrelFlower } from "@/components/SorrelFlower";
import {
  CONFIRMED_HOLD_MS,
  DAILY_READY_TIMEOUT_MS,
  WELCOME_BLOOM_MS,
  WELCOME_COOKIE,
  WELCOME_DISSOLVE_MS,
  WELCOME_OVERLAY_ID,
  clearCookieScript,
  parseWelcomeCookie,
  type WelcomeReason,
} from "@/lib/welcome";
import { onPageReady, onSignInSubmitted, resetPageReady, setWelcomeActive } from "@/lib/welcomeSignals";
import { consumeFirstInput } from "@/lib/consumeFirstInput";

// bloom: the flower assembling. waiting (daily only): the bloom is done
// but the page behind isn't; the flower is already swaying (CSS) and the
// gate holds until it is.
type Phase = "bloom" | "waiting" | "dissolving" | "done";

type Showing = { reason: "confirmed" } | { reason: "daily"; greeting: string };

// How long the host watches for A's cookie after a sign-in is submitted.
// It arrives with the response headers; this only bounds a sign-in that
// failed (no cookie) or a response that never came.
const WATCH_MS = 20000;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// How long the overlay has already been on screen. B paints from the HTML
// before React hydrates, and a timer started at hydration would add that
// gap to the hold. The bloom's own animation started at the first paint,
// so the timeline knows. 0 with no animation (reduced motion).
function onScreenMs(overlay: HTMLElement | null): number {
  const anim = overlay?.querySelector(".sorrel-flower__leaf")?.getAnimations()[0];
  const now = document.timeline.currentTime;
  if (!anim || anim.startTime === null || typeof now !== "number" || typeof anim.startTime !== "number") return 0;
  return Math.max(0, now - anim.startTime);
}

/**
 * The welcome: the one host for the bloom in front of the app, rendered by
 * the ROOT layout only (docs/Goal-Completion.md). It's on every page,
 * public ones included, so it survives the move from /login into the app;
 * its markup is always in the HTML, hidden by the `hidden` attribute --
 * never by a stylesheet, so there is no window in which it shows unstyled.
 * Kept small: it ships to every anonymous visitor. The flower is one
 * element start to finish, fully open whatever the hour -- a greeting, not
 * the day/night fold.
 *
 * "daily" (A): the first sign-in of the user's day. login() decides it,
 * sets the one-shot cookie with the greeting, and redirects -- one round
 * trip. The login form tells this host a sign-in is in flight; the host
 * watches for the cookie, which lands with the response headers, and
 * starts the bloom then -- before the redirect's page or the app's scripts
 * arrive -- so it costs max(bloom, load). Only a successful sign-in sets
 * the cookie, so a failed one never blooms. A gate: it plays to
 * completion and no input dismisses it. The flower sways in CSS from the
 * end of the bloom; the gate holds until the dashboard is ready
 * (components/WelcomeReady). Reduced motion skips it entirely.
 *
 * "confirmed" (B): a successful email confirmation. /auth/confirm sets a
 * one-shot cookie; WELCOME_SCRIPT (root layout) removes `hidden` before
 * first paint, and this takes over on hydration and clears the cookie. If
 * that script didn't reveal it, nothing shows -- it fails closed. Any input
 * dismisses it at once, and that input is consumed. It dissolves on its
 * own. Under reduced motion the flower arrives open and the copy is
 * unchanged.
 */
export function WelcomeBloom() {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [showing, setShowing] = useState<Showing | null>(null);
  const [phase, setPhase] = useState<Phase>("done");
  const [ready, setReady] = useState(false);
  const reason: WelcomeReason | null = showing?.reason ?? null;

  // B. A layout effect, before the first paint after hydration -- and,
  // because the host renders before the page content, before
  // SessionFlags decides whether to offer the sign-in fold.
  useLayoutEffect(() => {
    // Whatever it says, the one-shot is spent on this load: a daily value
    // found here (its sign-in already over) shows nothing.
    if (parseWelcomeCookie(document.cookie) !== null) {
      document.cookie = clearCookieScript(WELCOME_COOKIE);
    }
    // Only what the pre-paint script revealed. React doesn't patch an
    // attribute it finds changed at hydration (suppressHydrationWarning
    // below), so the overlay stays up until the state below catches up.
    if (overlayRef.current && !overlayRef.current.hidden) {
      setWelcomeActive(true);
      const frame = requestAnimationFrame(() => {
        setShowing({ reason: "confirmed" });
        setPhase("bloom");
      });
      return () => cancelAnimationFrame(frame);
    }
  }, []);

  // A. Watches for the cookie from the moment a sign-in is submitted.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => clearInterval(timer);
    const unsubscribe = onSignInSubmitted(() => {
      stop();
      const started = Date.now();
      timer = setInterval(() => {
        const found = parseWelcomeCookie(document.cookie);
        if (found?.reason === "daily") {
          stop();
          document.cookie = clearCookieScript(WELCOME_COOKIE);
          if (prefersReducedMotion()) return; // WCAG: skipped entirely
          setWelcomeActive(true);
          resetPageReady();
          setReady(false);
          setShowing({ reason: "daily", greeting: found.greeting });
          setPhase("bloom");
        } else if (Date.now() - started > WATCH_MS) {
          stop();
        }
      }, 16);
    });
    return () => {
      stop();
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (reason !== "daily" || phase === "done") return;
    return onPageReady(() => setReady(true));
  }, [reason, phase]);

  // It dissolves on its own. Daily: when the bloom has played AND the page
  // is ready -- whichever is later. Confirmed: after a reading hold.
  useEffect(() => {
    if (phase === "bloom") {
      const hold = reason === "daily" ? WELCOME_BLOOM_MS : CONFIRMED_HOLD_MS;
      const timer = setTimeout(
        () => setPhase(reason === "daily" ? "waiting" : "dissolving"),
        Math.max(0, hold - onScreenMs(overlayRef.current)),
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
    if (phase === "done") setWelcomeActive(false);
  }, [phase, reason, ready]);

  // Never trapped behind a flower: a page that never reports ready still
  // lets the daily welcome go.
  useEffect(() => {
    if (reason !== "daily" || phase === "done") return;
    const timer = setTimeout(() => setReady(true), DAILY_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [reason, phase]);

  // Confirmed only -- the daily welcome is a gate. Any input dismisses it
  // instantly, and is consumed, not passed through (lib/consumeFirstInput).
  useEffect(() => {
    if (reason !== "confirmed" || phase === "done") return;
    return consumeFirstInput(window, () => setPhase("done"));
  }, [reason, phase]);

  return (
    <div
      ref={overlayRef}
      id={WELCOME_OVERLAY_ID}
      hidden={phase === "done"}
      // WELCOME_SCRIPT removes `hidden` before hydration, on purpose. This
      // covers this element's own attributes only.
      suppressHydrationWarning
      role="status"
      className={`welcome-bloom fixed inset-0 z-50 bg-page ${reason === "daily" ? "welcome-bloom--gate" : ""} ${
        phase === "dissolving" ? "welcome-bloom--out" : ""
      }`}
    >
      <div className="flex h-full flex-col items-center justify-center gap-6 px-4 text-center">
        <SorrelFlower size={120} state="bloom" />
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-bold text-ink">
            {showing?.reason === "daily" ? showing.greeting : "Sorrel is yours."}
          </h2>
          {showing?.reason === "daily" ? null : (
            <p className="text-base text-ink-secondary">You&rsquo;re signed in and ready to go.</p>
          )}
        </div>
      </div>
    </div>
  );
}
