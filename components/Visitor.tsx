"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useReducedMotion } from "@/components/ui/useReducedMotion";
import type { TimeBand } from "@/lib/timeOfDay";
import { afterPlant } from "@/lib/plantSignals";
import { afterWelcome } from "@/lib/welcomeSignals";
import {
  VISITOR_AWAY_KEY,
  VISITOR_AWAY_MS,
  VISITOR_FLIGHT_MS,
  VISITOR_PERCH,
  VISITOR_SEEN_KEY,
  bandStamp,
  hasRoom,
  planVisitor,
  readVisitorState,
  visitorForBand,
  writeVisitorKey,
  type Box,
  type VisitorKind,
} from "@/lib/visitors";

// A visitor beside the dashboard greeting (docs/Visitors.md). Decorative:
// aria-hidden, not focusable, no announcement. It arrives once per part of
// the day per device, then sits perched, completely still. Display only --
// "seen" and "sent away" are per-device localStorage (lib/visitors.ts), the
// render writes nothing, and every animation is a one-shot CSS keyframe on
// transform or opacity (app/globals.css, "VISITORS"). The perch is on the
// roselle in the dashboard's scene (docs/Scenes.md; lib/visitors.ts,
// VISITOR_PERCH): the slot is placed against the plant's own box.

/** The arrival's floor after mount. It used to be 1.6s, to let the sign-in fold play; the
 *  plant (lib/plantSignals.ts) is waited on directly now, so nothing is guessed. */
const START_DELAY_MS = 0;
/** A beat after the welcome or a dialog closes, so nothing overlaps its exit. */
const BEAT_MS = 400;

// The ground the flight crosses, kept clear as well as the perch itself.
const ENVELOPE = { left: 24, top: 56, right: 14, bottom: 12 } as const;

const TEXT_OR_CONTROL = "h1, p, button, a, input, select, textarea, [data-visitor-avoid]";

function boxOf(r: DOMRect): Box {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/**
 * True when the slot's envelope is clear of every line of text and every
 * control in the page header. Text is measured by its glyphs, not its block:
 * at phone width the title's block spans the row but its words don't.
 */
export function measureRoom(slot: HTMLElement | null): boolean {
  const header = slot?.closest("[data-page-header]");
  if (!slot || !header) return false;
  const s = slot.getBoundingClientRect();
  if (s.width === 0 && s.height === 0) return false;
  const envelope: Box = {
    left: s.left - ENVELOPE.left,
    top: s.top - ENVELOPE.top,
    right: s.right + ENVELOPE.right,
    bottom: s.bottom + ENVELOPE.bottom,
  };
  const others: Box[] = [];
  for (const el of header.querySelectorAll(TEXT_OR_CONTROL)) {
    if (slot.contains(el)) continue;
    const isText = el.matches("h1, p");
    let rect: DOMRect;
    if (isText) {
      const range = document.createRange();
      range.selectNodeContents(el);
      rect = range.getBoundingClientRect();
    } else {
      rect = el.getBoundingClientRect();
    }
    if (rect.width === 0 && rect.height === 0) continue;
    others.push(boxOf(rect));
  }
  return hasRoom(envelope, others);
}

type Stage = "idle" | "perched" | "arrive" | "leaving";

export function Visitor({
  band,
  today,
  startDelayMs = START_DELAY_MS,
  measure = measureRoom,
}: {
  /** The greeting's band, from the server (lib/timeOfDay, the user's zone). */
  band: TimeBand;
  /** The user's calendar day (getToday()), for the per-band stamps. */
  today: string;
  /** Tests only. */
  startDelayMs?: number;
  /** Tests only: JSDOM can't lay anything out. */
  measure?: (slot: HTMLElement | null) => boolean;
}) {
  const kind = visitorForBand(band);
  const reduced = useReducedMotion();
  const [stage, setStage] = useState<Stage>("idle");
  const [room, setRoom] = useState(false);
  const [landed, setLanded] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const mountedAt = useRef(0);
  const gradientId = `visitor-glow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  // Is there room, now and as the layout changes? Hidden, not squeezed.
  useEffect(() => {
    const check = () => setRoom(measure(slotRef.current));
    const raf = requestAnimationFrame(check);
    const header = slotRef.current?.closest("[data-page-header]");
    const observer = typeof ResizeObserver !== "undefined" && header ? new ResizeObserver(check) : null;
    if (observer && header) observer.observe(header);
    window.addEventListener("resize", check);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [measure]);

  // What to show, once, from storage. A render writes nothing: "seen" is
  // recorded only when an arrival actually starts.
  useEffect(() => {
    mountedAt.current = Date.now();
    const plan = planVisitor(readVisitorState(), today, band, reduced);
    let cancelled = false;
    const cleanups: (() => void)[] = [];
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => !cancelled && fn(), ms);
      cleanups.push(() => clearTimeout(t));
    };

    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      if (plan === "none") return setStage("idle");
      if (plan === "perched") return setStage("perched");

      // Arrival: after the welcome bloom, after the dashboard plant has
      // opened or closed, and with no dialog open. Never two arrivals at once.
      setStage("idle");
      const dialogOpen = () => document.querySelector("dialog[open]") !== null;
      const start = () => {
        if (cancelled) return;
        if (dialogOpen()) {
          // Watch the dialog close, then take a beat and look again.
          const observer = new MutationObserver(() => {
            if (dialogOpen()) return;
            observer.disconnect();
            later(start, BEAT_MS);
          });
          observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
          cleanups.push(() => observer.disconnect());
          return;
        }
        if (!measure(slotRef.current)) return; // no room at this width: not at all
        writeVisitorKey(VISITOR_SEEN_KEY, bandStamp(today, band));
        setLanded(false);
        setStage("arrive");
      };
      // The plant decides whether it will play in its own effect, before
      // this frame runs, and it only starts after the welcome ends.
      cleanups.push(
        afterWelcome(() => {
          cleanups.push(
            afterPlant(() => {
              const sinceMount = Date.now() - mountedAt.current;
              later(start, Math.max(BEAT_MS, startDelayMs - sinceMount));
            }),
          );
        }),
      );
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      for (const fn of cleanups) fn();
    };
  }, [band, today, reduced, startDelayMs, measure]);

  // Flight over: it can take a tap. A timer backs up animationend.
  useEffect(() => {
    if (stage !== "arrive") return;
    const t = setTimeout(() => setLanded(true), VISITOR_FLIGHT_MS[kind] + 200);
    return () => clearTimeout(t);
  }, [stage, kind]);

  // A tap's flight off ends in nothing at all.
  useEffect(() => {
    if (stage !== "leaving") return;
    const t = setTimeout(() => setStage("idle"), VISITOR_AWAY_MS);
    return () => clearTimeout(t);
  }, [stage]);

  const sendAway = () => {
    writeVisitorKey(VISITOR_AWAY_KEY, bandStamp(today, band));
    setStage(reduced ? "idle" : "leaving");
  };

  const shown = room && (stage === "perched" || stage === "arrive" || stage === "leaving");

  return (
    <div
      ref={slotRef}
      aria-hidden="true"
      data-visitor-slot=""
      // The slot never takes a pointer; only the visitor's own box does.
      className="pointer-events-none absolute flex h-12 w-11 origin-bottom items-end justify-center max-sm:scale-[0.85]"
      style={{ left: `calc(${VISITOR_PERCH[kind].x}% - 22px)`, bottom: `${VISITOR_PERCH[kind].y}%` }}
    >
      {shown ? (
        <div
          data-visitor={kind}
          data-stage={stage}
          className={`visitor ${stage === "arrive" ? "visitor--arrive" : ""} ${stage === "leaving" ? "visitor--away" : ""}`}
          style={{ pointerEvents: stage === "perched" || (stage === "arrive" && landed) ? "auto" : "none" }}
          onClick={sendAway}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget && e.animationName.startsWith("visitor-fly")) setLanded(true);
          }}
        >
          <div className="visitor__body">
            <Drawing kind={kind} gradientId={gradientId} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// The four drawings, exactly as given in docs/Visitors.md. Only the light
// theme needed a change: parts the doc fixes at near-white (the butterfly's
// body and antennae, the firefly's wings) use the ink token, so they stay
// visible on a light page and are the doc's near-white on a dark one.
function Drawing({ kind, gradientId }: { kind: VisitorKind; gradientId: string }) {
  switch (kind) {
    case "songbird":
      return (
        <svg width="42" height="38" viewBox="0 0 42 38" aria-hidden="true" focusable="false">
          <path d="M30 18 L41 13 L39 23 Z" fill="#A97A22" />
          <ellipse cx="21" cy="21" rx="13" ry="11" fill="#C99632" />
          <ellipse cx="18" cy="24" rx="8" ry="6" fill="#F3CF7A" />
          <circle cx="11" cy="13" r="7.5" fill="#C99632" />
          <circle cx="8.6" cy="12" r="1.5" fill="#0B0B12" />
          <path d="M3.6 13 L0 14.6 L3.6 16 Z" fill="#E8B44A" />
          <path className="visitor__wing" d="M17 17 C23 10 31 12 33 19 C27 21 21 22 17 17 Z" fill="#A97A22" />
          <path d="M18 31 V36 M23 31 V36" stroke="#A5A2B4" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "butterfly":
      return (
        <svg width="36" height="30" viewBox="0 0 36 30" aria-hidden="true" focusable="false">
          <g className="visitor__wings">
            <path d="M18 14 C10 2 2 4 4 12 C6 17 13 17 18 15 Z" fill="#E8B44A" />
            <path d="M18 16 C11 18 6 26 11 27 C15 27 17 22 18 17 Z" fill="#F3CF7A" />
            <path d="M18 14 C26 2 34 4 32 12 C30 17 23 17 18 15 Z" fill="#E8B44A" />
            <path d="M18 16 C25 18 30 26 25 27 C21 27 19 22 18 17 Z" fill="#F3CF7A" />
          </g>
          <ellipse cx="18" cy="16" rx="1.7" ry="8" fill="var(--ink)" />
          <path
            d="M17.4 8.5 C16 5 14 4 13 4 M18.6 8.5 C20 5 22 4 23 4"
            stroke="var(--ink)"
            strokeWidth="1"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      );
    case "firefly":
      return (
        <svg width="28" height="28" viewBox="0 0 28 28" style={{ overflow: "visible" }} aria-hidden="true" focusable="false">
          <defs>
            <radialGradient id={gradientId}>
              <stop offset="0%" stopColor="#F3CF7A" stopOpacity=".9" />
              <stop offset="100%" stopColor="#F3CF7A" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle className="visitor__halo" cx="14" cy="19" r="14" fill={`url(#${gradientId})`} />
          <ellipse cx="10" cy="10" rx="4" ry="2.4" fill="var(--ink)" fillOpacity=".45" transform="rotate(-25 10 10)" />
          <ellipse cx="18" cy="10" rx="4" ry="2.4" fill="var(--ink)" fillOpacity=".45" transform="rotate(25 18 10)" />
          <ellipse cx="14" cy="13" rx="2.6" ry="4.4" fill="#4A4A5E" />
          <ellipse cx="14" cy="19" rx="2.8" ry="3.2" fill="#F3CF7A" />
        </svg>
      );
    case "owl":
      return (
        <svg width="44" height="48" viewBox="0 0 44 48" aria-hidden="true" focusable="false">
          <path d="M9 12 L12 2 L17 9 Z M35 12 L32 2 L27 9 Z" fill="#3B4A73" />
          <ellipse cx="22" cy="28" rx="15.5" ry="17" fill="#3B4A73" />
          <ellipse cx="22" cy="33" rx="10" ry="11" fill="#5B6B95" />
          <circle cx="15.5" cy="20" r="7" fill="#D9DCEB" />
          <circle cx="28.5" cy="20" r="7" fill="#D9DCEB" />
          <circle cx="15.5" cy="20" r="3.4" fill="#0B0B12" />
          <circle cx="28.5" cy="20" r="3.4" fill="#0B0B12" />
          <circle cx="16.6" cy="18.8" r="1" fill="#F6F4F8" />
          <circle cx="29.6" cy="18.8" r="1" fill="#F6F4F8" />
          <rect className="visitor__lid" x="8.5" y="13" width="27" height="14" rx="7" fill="#3B4A73" />
          <path d="M20.5 25 L22 29 L23.5 25 Z" fill="#E8B44A" />
          <path
            d="M17 45 L17 47.5 M20 45 L20 47.5 M24 45 L24 47.5 M27 45 L27 47.5"
            stroke="#E8B44A"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}
