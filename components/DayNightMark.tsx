"use client";

import { useEffect, useState } from "react";
import { SorrelMark } from "@/components/SorrelMark";
import { SIGNED_IN_COOKIE } from "@/lib/auth/signedInFlag";

type MarkState = "open" | "folded";

const DAY_START = 7; // 7:00am -- open
const NIGHT_START = 19; // 7:00pm -- folded

// Always the browser's local clock. This component only decides state after
// mount, so the server's timezone never gets a say.
function stateForHour(now: Date): MarkState {
  const h = now.getHours();
  return h >= DAY_START && h < NIGHT_START ? "open" : "folded";
}

// Milliseconds until the next 7:00 or 19:00, local time. Built with the Date
// constructor rather than adding hours, so a DST change lands on the wall
// clock boundary rather than an hour either side of it.
function msUntilNextBoundary(now: Date): number {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  const h = now.getHours();
  if (h < DAY_START) next.setHours(DAY_START);
  else if (h < NIGHT_START) next.setHours(NIGHT_START);
  else {
    next.setDate(next.getDate() + 1);
    next.setHours(DAY_START);
  }
  return next.getTime() - now.getTime();
}

function consumeSignedInFlag(): boolean {
  const present = document.cookie
    .split("; ")
    .some((c) => c === `${SIGNED_IN_COOKIE}=1`);
  if (present) document.cookie = `${SIGNED_IN_COOKIE}=; Max-Age=0; path=/`;
  return present;
}

// Fold runs 600ms plus the last leaflet's 90ms stagger (app/globals.css).
const FOLD_MS = 690;
const HOLD_MS = 400;

/**
 * The dashboard's Sorrel mark: open 7:00am-6:59pm, folded 7:00pm-6:59am,
 * flipping live when the clock crosses either boundary. Straight after
 * sign-in it plays fold -> hold -> reopen, then settles into the hour's
 * state. Ambient only -- decorative to assistive tech.
 */
export function DayNightMark({ size = 56 }: { size?: number }) {
  // null until mounted: the server can't know the viewer's local hour, and
  // rendering a guessed state would either mismatch on hydration or animate
  // into the real one on every page load at night.
  const [state, setState] = useState<MarkState | null>(null);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let boundaryTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = () => setState(stateForHour(new Date()));

    // A timer per boundary, re-armed on each fire. visibilitychange covers
    // the cases setTimeout can't: a sleeping laptop or a throttled
    // background tab waking up past the boundary.
    const arm = () => {
      clearTimeout(boundaryTimer);
      boundaryTimer = setTimeout(() => {
        settle();
        arm();
      }, msUntilNextBoundary(new Date()));
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
    const playSignIn = consumeSignedInFlag() && !reduceMotion;

    // Every state update waits for a frame. For the sign-in sequence that's
    // load-bearing: the open state has to paint before the fold class
    // lands, or the browser has nothing to transition from.
    const frames: number[] = [];
    frames.push(
      requestAnimationFrame(() => {
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
  }, []);

  return (
    <span aria-hidden="true" className="block shrink-0" style={{ width: size, height: size }}>
      {state ? <SorrelMark size={size} state={state} /> : null}
    </span>
  );
}
