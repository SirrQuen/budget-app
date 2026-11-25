"use client";

import { useEffect, useRef, useState } from "react";
import { Roselle, type RoselleMotion } from "@/components/Roselle";
import { prefersReducedMotion } from "@/components/ui/useReducedMotion";
import { todayInZone } from "@/lib/date";
import {
  PLANT_PLAY_MS,
  otherPlantState,
  planPlant,
  plantStamp,
  plantStateAt,
  readPlantSeen,
  writePlantSeen,
  type PlantState,
} from "@/lib/plant";
import { setPlantBusy } from "@/lib/plantSignals";
import { hourInZone, msUntilNextMarkBoundary, type MarkState } from "@/lib/timeOfDay";
import { afterWelcome } from "@/lib/welcomeSignals";

// The plant stands on the near hill of the dashboard's scene (docs/Scenes.md;
// placed by .dash-banner__perch). 120px tall from 640px up, 88px on a phone
// (docs/Roselle.md), width following the drawing's 240:280; at those sizes
// every stem calyx is over 14px.
/** The reveal fade (app/globals.css, .roselle-slot). */
const REVEAL_MS = 150;
/** No decision by now: show the resting pose. */
const REVEAL_FALLBACK_MS = 2000;

/**
 * The dashboard's living plant (docs/Roselle.md): a roselle, open
 * 7:00am-6:59pm and closed 7:00pm-6:59am in the user's stored zone
 * (lib/timeOfDay.ts -- the same clock as the dashboard's scene). The server
 * renders the pose for its own hour, so there is no flash and nothing to
 * guess on hydration.
 *
 * It plays its change once per device: sorrel-plant-seen holds
 * `<date>:<open|closed>`, and the first dashboard visit that finds a
 * different stamp plays the opening or closing (~1.6s); every other visit
 * rests. In turn: the welcome bloom first, then the plant, then the visitor
 * (lib/plantSignals.ts) -- never two at once. Reduced motion, or storage that
 * can't be read or written, rests in the pose for the hour. A boundary
 * crossed while the page is open plays live, since the person is watching it
 * happen.
 *
 * Display only; a render writes nothing. Decorative -- hidden from
 * assistive tech. Not the brand mark.
 */
export function DayNightMark({
  timeZone,
  initialState,
}: {
  /** settings.timezone (getTimeZone()); null is UTC. */
  timeZone: string | null;
  /** markStateAt(timeZone, now), computed on the server for the first paint. */
  initialState: MarkState;
}) {
  const initial: PlantState = initialState === "open" ? "open" : "closed";
  const [pose, setPose] = useState<PlantState>(initial);
  const [motion, setMotion] = useState<RoselleMotion>(null);
  // False until the client has decided the pose (play or rest): the server's
  // pose is a guess about this device, so it is never shown. Then it fades in
  // already in the pose it starts from.
  const [ready, setReady] = useState(false);
  // What the effects below last drew, for comparing against the clock
  // without re-subscribing on every change.
  const poseRef = useRef<PlantState>(initial);

  useEffect(() => {
    const cleanups: (() => void)[] = [];
    const frames: number[] = [];
    let boundaryTimer: ReturnType<typeof setTimeout> | undefined;
    let playTimer: ReturnType<typeof setTimeout> | undefined;
    let revealTimer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;

    let decided = false;
    const draw = (next: PlantState, play: boolean) => {
      decided = true;
      poseRef.current = next;
      setReady(true);
      setPose(next);
      setMotion(play ? (next === "open" ? "opening" : "closing") : null);
    };
    const release = () => {
      if (!busy) return;
      busy = false;
      setPlantBusy(false);
    };
    const playFor = () => {
      clearTimeout(playTimer);
      playTimer = setTimeout(release, PLANT_PLAY_MS);
    };

    const now = () => new Date();
    const target = () => plantStateAt(timeZone, now());
    const stampNow = () => {
      const n = now();
      return plantStamp(todayInZone(timeZone, n), hourInZone(timeZone, n));
    };

    // On mount: decide, synchronously, whether this visit plays -- the
    // visitor (a sibling) reads the answer from a frame callback, after
    // every effect has run.
    const state = target();
    // If the decision is somehow still pending after 2s, show the resting
    // pose rather than keep the plant hidden (and never hold the visitor).
    const fallback = setTimeout(() => {
      if (decided) return;
      draw(target(), false);
      release();
    }, REVEAL_FALLBACK_MS);
    const plan = planPlant(readPlantSeen(), stampNow(), prefersReducedMotion());
    if (plan === "play") {
      busy = true;
      setPlantBusy(true);
      // Held in the pose it is changing from, drawn before anything plays,
      // so it never shows the new pose and then jumps back to animate.
      frames.push(requestAnimationFrame(() => draw(otherPlantState(state), false)));
      // After the welcome, and a beat after the reveal fade, so the plant
      // is on screen in its starting pose before anything moves.
      cleanups.push(
        afterWelcome(() => {
          revealTimer = setTimeout(() => {
            frames.push(
              requestAnimationFrame(() => {
                const current = target();
                // Storage that takes no write can't remember a play: rest.
                if (!writePlantSeen(stampNow())) {
                  draw(current, false);
                  release();
                  return;
                }
                draw(current, true);
                playFor();
              }),
            );
          }, REVEAL_MS);
        }),
      );
    } else {
      frames.push(requestAnimationFrame(() => draw(state, false)));
    }

    // A boundary crossed (or a tab waking past one) while the page is open:
    // the change happens in front of the person, so it plays now.
    const settle = () => {
      const next = target();
      if (next === poseRef.current) return;
      if (prefersReducedMotion()) return draw(next, false);
      writePlantSeen(stampNow());
      draw(next, true);
      busy = true;
      setPlantBusy(true);
      playFor();
    };
    const arm = () => {
      clearTimeout(boundaryTimer);
      boundaryTimer = setTimeout(() => {
        settle();
        arm();
      }, msUntilNextMarkBoundary(timeZone, now()));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        settle();
        arm();
      }
    };
    arm();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      frames.forEach(cancelAnimationFrame);
      cleanups.forEach((fn) => fn());
      clearTimeout(boundaryTimer);
      clearTimeout(playTimer);
      clearTimeout(revealTimer);
      clearTimeout(fallback);
      document.removeEventListener("visibilitychange", onVisible);
      release();
    };
  }, [timeZone]);

  return (
    <span
      aria-hidden="true"
      className="roselle-slot block h-full w-full"
      style={{ opacity: ready ? 1 : 0 }}
    >
      <Roselle pose={pose} motion={motion} height={120} className="block h-full w-full" />
    </span>
  );
}
