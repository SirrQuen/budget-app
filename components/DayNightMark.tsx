"use client";

import { useEffect, useState } from "react";
import { SorrelFlower } from "@/components/SorrelFlower";
import { takeSignInFold } from "@/lib/welcomeSignals";
import { markStateAt, msUntilNextMarkBoundary, type MarkState } from "@/lib/timeOfDay";

// Fold runs --flower-fold-duration (820ms) plus two --flower-petal-stagger
// (100ms) steps (app/globals.css, SORREL FLOWER).
const FOLD_MS = 1020;
const HOLD_MS = 400;

/**
 * The dashboard's Sorrel flower: open 7:00am-6:59pm, folded 7:00pm-6:59am
 * in the user's stored zone (lib/timeOfDay.ts -- the same hour as the
 * dashboard's glow), flipping live when that clock crosses either boundary.
 * The server renders the state for its own hour, so there is no flash and
 * nothing to guess on hydration. Straight after sign-in it plays fold -> hold -> reopen, then settles into the hour's
 * state -- unless the welcome bloom (components/WelcomeBloom.tsx) played
 * on this load, which supersedes it. Ambient only -- decorative to
 * assistive tech.
 */
export function DayNightMark({
  size = 56,
  timeZone,
  initialState,
}: {
  size?: number;
  /** settings.timezone (getTimeZone()); null is UTC. */
  timeZone: string | null;
  /** markStateAt(timeZone, now), computed on the server for the first paint. */
  initialState: MarkState;
}) {
  // The server already knows the hour in the stored zone, so the first
  // paint is the right state. (A flower that mounts folded arrives folded:
  // SorrelFlower only folds on a CHANGE.)
  const [state, setState] = useState<MarkState>(initialState);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let boundaryTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = () => setState(markStateAt(timeZone, new Date()));

    // A timer per boundary, re-armed on each fire. visibilitychange covers
    // the cases setTimeout can't: a sleeping laptop or a throttled
    // background tab waking up past the boundary.
    const arm = () => {
      clearTimeout(boundaryTimer);
      boundaryTimer = setTimeout(() => {
        settle();
        arm();
      }, msUntilNextMarkBoundary(timeZone, new Date()));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        settle();
        arm();
      }
    };

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Under reduced motion the sign-in sequence is skipped rather than
    // played instantly -- an instant fold/reopen is just a blink.
    const path = window.location.pathname;

    // Every state update waits for a frame. For the sign-in sequence that's
    // load-bearing: the open state has to paint before the fold class
    // lands, or the browser has nothing to transition from.
    const frames: number[] = [];
    frames.push(
      requestAnimationFrame(() => {
        // The sign-in flag is consumed by the layout (components/
        // SessionFlags.tsx), which offers the fold only when no welcome
        // bloom plays -- the bloom supersedes it. Taken here, a frame after
        // mount, so the layout's layout effect has always run by now; taken
        // even under reduced motion, so it can't play later.
        const offered = takeSignInFold(path);
        // At night the flower already arrived folded: there is no fold to
        // play, and opening it just to close it again would be a blink.
        const playSignIn = offered && !reduceMotion && markStateAt(timeZone, new Date()) === "open";
        if (!playSignIn) {
          settle();
          return;
        }
        setState("open");
        frames.push(
          requestAnimationFrame(() =>
            frames.push(
              requestAnimationFrame(() => {
                setState("folded");
                timers.push(setTimeout(() => setState("open"), FOLD_MS + HOLD_MS));
                timers.push(setTimeout(settle, FOLD_MS + HOLD_MS + FOLD_MS));
              }),
            ),
          ),
        );
      }),
    );

    arm();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      frames.forEach(cancelAnimationFrame);
      timers.forEach(clearTimeout);
      clearTimeout(boundaryTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [timeZone]);

  return (
    <span aria-hidden="true" className="block shrink-0" style={{ width: size, height: size }}>
      <SorrelFlower size={size} state={state} />
    </span>
  );
}
