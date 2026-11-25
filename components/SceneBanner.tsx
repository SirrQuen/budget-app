"use client";

import { useEffect, useRef, useState } from "react";
import { Scene } from "@/components/Scene";
import { prefersReducedMotion } from "@/components/ui/useReducedMotion";
import { formatDateWithWeekday } from "@/lib/format";
import { msUntilNextBandBoundary, timeBandAt, type TimeBand } from "@/lib/timeOfDay";

/** The cross-fade's length; app/globals.css (.dash-scene__layer--in) matches it. */
export const SCENE_FADE_MS = 600;

/**
 * The dashboard's header, in its landscape (docs/Scenes.md). One clock: the
 * band is lib/timeOfDay's in the user's stored zone, and the same band picks
 * the greeting, the scene and the visitor, so they can't disagree. The server
 * renders its own band, so there is nothing to flash; on load the scene simply
 * appears.
 *
 * When the band changes while the page is open -- one timer to the next
 * boundary, re-checked when a sleeping tab wakes -- the new scene fades in
 * over the old once. Reduced motion: swapped, no fade. Nothing is stored.
 */
export function SceneBanner({
  timeZone,
  initialBand,
  greetings,
  today,
  pill,
  perch,
}: {
  /** settings.timezone (getTimeZone()); null is UTC. */
  timeZone: string | null;
  /** timeBandAt(timeZone, now), computed on the server. */
  initialBand: TimeBand;
  /** welcomeMessage() for every band, built on the server. */
  greetings: Record<TimeBand, string>;
  /** The user's calendar day. */
  today: string;
  /** The "Your Sorrel" button. */
  pill?: React.ReactNode;
  /** The plant and its visitor, standing on the near hill. */
  perch?: (band: TimeBand) => React.ReactNode;
}) {
  const [shown, setShown] = useState<{ band: TimeBand; outgoing: TimeBand | null }>({
    band: initialBand,
    outgoing: null,
  });
  const bandRef = useRef(initialBand);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fade: ReturnType<typeof setTimeout> | undefined;

    const settle = (animate: boolean) => {
      const next = timeBandAt(timeZone, new Date());
      const previous = bandRef.current;
      if (next === previous) return;
      bandRef.current = next;
      clearTimeout(fade);
      const play = animate && !prefersReducedMotion();
      setShown({ band: next, outgoing: play ? previous : null });
      if (play) fade = setTimeout(() => setShown({ band: next, outgoing: null }), SCENE_FADE_MS);
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          settle(true);
          arm();
        },
        msUntilNextBandBoundary(timeZone, new Date()),
      );
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      settle(true);
      arm();
    };

    // On load there is no animation: if the server's band is already past,
    // the current one just takes its place.
    const frame = requestAnimationFrame(() => settle(false));
    arm();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      clearTimeout(fade);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [timeZone]);

  const { band, outgoing } = shown;
  const layers = outgoing ? [outgoing, band] : [band];

  return (
    <div data-page-header="" data-band={band} className="dash-banner">
      <div aria-hidden="true" className="dash-scene">
        {/* Keyed by band, so the outgoing layer stays the same node. */}
        {layers.map((layer) => (
          <div
            key={layer}
            data-scene={layer}
            className={`dash-scene__layer scene--${layer} ${outgoing && layer === band ? "dash-scene__layer--in" : ""}`}
          >
            <Scene band={layer} />
            <div className="dash-scene__scrim" />
          </div>
        ))}
      </div>

      <div className="dash-banner__words">
        {/* Focusable by script only: where focus lands when the thing that
            had it is removed (see PageHeader). */}
        <h1 id="page-title" tabIndex={-1} className="text-2xl font-semibold text-ink focus:outline-none">
          Dashboard
        </h1>
        <p data-banner-date="" className="mt-1 text-sm text-ink-secondary">
          {formatDateWithWeekday(today)}
        </p>
        <p data-banner-greeting="" className="mt-1 text-sm text-ink-secondary">
          {greetings[band]}
        </p>
        {pill ? <div className="mt-1">{pill}</div> : null}
      </div>

      {perch ? <div className="dash-banner__perch">{perch(band)}</div> : null}
    </div>
  );
}
