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

// The slot is the old flower's 56px, so the row (and the hero under it) sits
// where it always has. The plant is taller than the slot and rises out of its
// top, over the empty space above the row -- never down over the hero. Height
// is ~100px from 640px up, 88px on a phone; the calyces are drawn 1.4x so
// every one is >= 14px (>= 12px on a phone). See docs/Roselle.md.
const ROW_PX = 56;

/**
 * The dashboard's living plant (docs/Roselle.md): a roselle, open
 * 7:00am-6:59pm and closed 7:00pm-6:59am in the user's stored zone
 * (lib/timeOfDay.ts -- the same clock as the dashboard's glow). The server
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
  size = ROW_PX,
  timeZone,
  initialState,
}: {
  /** The row's height in px: the footprint in the layout, which the plant never grows. */
  size?: number;
  /** settings.timezone (getTimeZone()); null is UTC. */
  timeZone: string | null;
  /** markStateAt(timeZone, now), computed on the server for the first paint. */
  initialState: MarkState;
}) {
  const initial: PlantState = initialState === "open" ? "open" : "closed";
  const [pose, setPose] = useState<PlantState>(initial);
  const [motion, setMotion] = useState<RoselleMotion>(null);
  // What the effects below last drew, for comparing against the clock
  // without re-subscribing on every change.
  const poseRef = useRef<PlantState>(initial);

  useEffect(() => {
    const cleanups: (() => void)[] = [];
    const frames: number[] = [];
    let boundaryTimer: ReturnType<typeof setTimeout> | undefined;
    let playTimer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;

    const draw = (next: PlantState, play: boolean) => {
      poseRef.current = next;
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
    const plan = planPlant(readPlantSeen(), stampNow(), prefersReducedMotion());
    if (plan === "play") {
      busy = true;
      setPlantBusy(true);
      // Held in the pose it is changing from, drawn before anything plays,
      // so it never shows the new pose and then jumps back to animate.
      frames.push(requestAnimationFrame(() => draw(otherPlantState(state), false)));
      cleanups.push(
        afterWelcome(() => {
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
      document.removeEventListener("visibilitychange", onVisible);
      release();
    };
  }, [timeZone]);

  return (
    <span aria-hidden="true" className="relative block w-[75px] shrink-0 sm:w-[86px]" style={{ height: size }}>
      <Roselle
        pose={pose}
        motion={motion}
        height={100}
        className="absolute bottom-0 right-0 h-[88px] w-[75.4px] sm:h-[100px] sm:w-[85.7px]"
      />
    </span>
  );
}
