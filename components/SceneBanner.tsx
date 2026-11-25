"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Scene, SceneCopy } from "@/components/Scene";
import { prefersReducedMotion } from "@/components/ui/useReducedMotion";
import { GLASS_TILE, backdropGeometry } from "@/lib/backdrop";
import { formatDateWithWeekday } from "@/lib/format";
import { msUntilNextBandBoundary, timeBandAt, type TimeBand } from "@/lib/timeOfDay";

/** The cross-fade's length; app/globals.css (.dash-scene__layer--in) matches it. */
export const SCENE_FADE_MS = 600;

/** Toggled on the backdrop by the fallback softening (no scroll timelines). */
export const SOFT_CLASS = "dash-backdrop--soft";

/**
 * Lines the fixed backdrop up with the banner (docs/Backdrop.md): the scene
 * goes where the banner's empty slot is at scroll 0, and the softening runs
 * over the scroll it takes the first card to cover it. Read when the layout
 * changes, never on scroll. Where scroll-driven animations aren't supported,
 * one IntersectionObserver on a marker halfway along toggles a class.
 */
function useBackdrop(
  banner: React.RefObject<HTMLDivElement | null>,
  stage: React.RefObject<HTMLDivElement | null>,
  backdrop: React.RefObject<HTMLDivElement | null>,
  marker: React.RefObject<HTMLDivElement | null>,
) {
  useLayoutEffect(() => {
    const b = banner.current;
    const s = stage.current;
    const d = backdrop.current;
    const m = marker.current;
    if (!b || !s || !d || !m) return;
    const root = b.closest(".dash-glass") ?? document.body;

    const measure = () => {
      const slot = s.getBoundingClientRect();
      const card = [...root.querySelectorAll<HTMLElement>(GLASS_TILE)].find(
        (el) => !b.contains(el) && el.getBoundingClientRect().height > 0,
      );
      const g = backdropGeometry({
        stageTop: slot.top,
        stageHeight: slot.height,
        firstCardTop: card ? card.getBoundingClientRect().top : null,
        scrollY: window.scrollY,
      });
      d.style.setProperty("--scene-top", `${g.sceneTop}px`);
      d.style.setProperty("--scene-h", `${g.sceneHeight}px`);
      d.style.setProperty("--soften-distance", `${g.softenDistance}px`);
      // The marker sits at document y = half the distance, so it leaves the
      // top of the viewport when the page has scrolled that far.
      const bannerTop = b.getBoundingClientRect().top + window.scrollY;
      m.style.setProperty("top", `${Math.round(g.softenDistance / 2 - bannerTop)}px`);
    };
    measure();
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    resize?.observe(document.body);
    resize?.observe(b);
    window.addEventListener("resize", measure);

    const timelines = typeof CSS !== "undefined" && CSS.supports?.("animation-timeline: scroll()");
    const io =
      !timelines && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => {
            d.classList.toggle(SOFT_CLASS, !entry.isIntersecting && entry.boundingClientRect.top < 0);
          })
        : null;
    io?.observe(m);

    return () => {
      resize?.disconnect();
      io?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [banner, stage, backdrop, marker]);
}

/**
 * The dashboard's header, in its landscape (docs/Scenes.md). One clock: the
 * band is lib/timeOfDay's in the user's stored zone, and the same band picks
 * the greeting, the scene and the visitor, so they can't disagree. The server
 * renders its own band, so there is nothing to flash; on load the scene simply
 * appears.
 *
 * The scene is the top of a fixed backdrop behind the whole dashboard
 * (docs/Backdrop.md): sky above it, ground below it, the plant and visitor on
 * its hill, and a static softened copy the scroll fades in as the cards cover
 * it. The banner itself keeps the words and an empty slot the backdrop lines
 * its scene up with.
 *
 * When the band changes while the page is open -- one timer to the next
 * boundary, re-checked when a sleeping tab wakes -- the new backdrop fades in
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
  const bannerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const artId = `scene-art-${useId().replace(/[^\w-]/g, "")}`;
  useBackdrop(bannerRef, stageRef, backdropRef, markerRef);

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
  const fadeClass = (layer: TimeBand) => (outgoing && layer === band ? "dash-scene__layer--in" : "");

  return (
    <div ref={bannerRef} data-page-header="" data-band={band} className="dash-banner">
      {/* Fixed, behind every card on the page. Decorative; it takes no
          pointer except the visitor's own box. */}
      <div ref={backdropRef} aria-hidden="true" className="dash-backdrop">
        {/* Keyed by band, so the outgoing layer stays the same node. */}
        {layers.map((layer) => (
          <div key={layer} data-scene={layer} className={`dash-scene__layer scene--${layer} ${fadeClass(layer)}`}>
            <Painting>
              <Scene band={layer} artId={`${artId}-${layer}`} />
            </Painting>
          </div>
        ))}
        {perch ? (
          <div className="dash-backdrop__column">
            <div className="dash-backdrop__perch">{perch(band)}</div>
          </div>
        ) : null}
        {/* The softened scene: a static blurred copy of the same art and a
            dim, faded in by the scroll. Nothing animates a filter. */}
        <div className="dash-backdrop__soft">
          {layers.map((layer) => (
            <div key={layer} className={`dash-scene__layer scene--${layer} ${fadeClass(layer)}`}>
              <div className="dash-backdrop__blur">
                <Painting>
                  <SceneCopy artId={`${artId}-${layer}`} />
                </Painting>
              </div>
            </div>
          ))}
          <div className="dash-backdrop__dim" />
        </div>
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

      {/* Where the backdrop's scene sits at scroll 0: room, nothing drawn. */}
      <div ref={stageRef} className="dash-banner__stage" />
      <div ref={markerRef} className="dash-banner__marker" />
    </div>
  );
}

/** One band's backdrop, top to bottom: sky, the scene and its scrim, ground. */
function Painting({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="dash-backdrop__sky" />
      <div className="dash-backdrop__band">{children}</div>
      <div className="dash-backdrop__column">
        <div className="dash-scene__scrim" />
      </div>
      <div className="dash-backdrop__ground" />
    </>
  );
}
