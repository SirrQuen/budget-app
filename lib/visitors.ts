import type { TimeBand } from "@/lib/timeOfDay";

// Visitors (docs/Visitors.md): a small creature that flies in beside the
// dashboard greeting the first time someone opens it in each part of the day.
// This file is the pure half -- which visitor, and whether it arrives, sits
// perched, or isn't there. Display only: the three keys are per-device
// localStorage, never the database, and a render writes nothing (the
// component records "seen" in an effect, when an arrival actually starts).

export type VisitorKind = "songbird" | "butterfly" | "firefly" | "owl";

// The visitor follows the greeting's band (lib/timeOfDay), in the user's zone.
const VISITOR_FOR_BAND: Record<TimeBand, VisitorKind> = {
  morning: "songbird",
  afternoon: "butterfly",
  evening: "firefly",
  night: "owl",
};

export function visitorForBand(band: TimeBand): VisitorKind {
  return VISITOR_FOR_BAND[band];
}

/**
 * Where each one perches on the dashboard's roselle (docs/Scenes.md; the
 * design board's positions): the visitor's centre across the plant's box, and
 * its feet above the plant's base, both in percent.
 */
export const VISITOR_PERCH: Record<VisitorKind, { x: number; y: number }> = {
  songbird: { x: 55, y: 78 },
  butterfly: { x: 88, y: 91 },
  firefly: { x: 98, y: 87 },
  owl: { x: 53, y: 80 },
};

/** `visitor-seen`: `<local date>:<band>`, the last band whose arrival played. */
export const VISITOR_SEEN_KEY = "visitor-seen";
/** `visitor-away`: `<local date>:<band>`, sent away by a tap for that band. */
export const VISITOR_AWAY_KEY = "visitor-away";
/** `visitors-off`: the Settings choice. "1" means off; anything else, on. */
export const VISITORS_OFF_KEY = "visitors-off";

/** One band on one day, in the user's zone: a new band or a new day is a new visitor. */
export function bandStamp(today: string, band: TimeBand): string {
  return `${today}:${band}`;
}

/** Timings from docs/Visitors.md ("How it moves"), shared with globals.css. */
export const VISITOR_FLIGHT_MS: Record<VisitorKind, number> = {
  songbird: 1100,
  butterfly: 1200,
  firefly: 1200,
  owl: 1200,
};
/** The squash-and-settle after landing (songbird, owl; the others just rest). */
export const VISITOR_SETTLE_MS = 100;
/** A tap sends it off for this long. */
export const VISITOR_AWAY_MS = 600;

export type VisitorState = {
  /** Whatever storage could be read; `null` is a key that isn't there. */
  seen: string | null;
  away: string | null;
  off: string | null;
  /** False when localStorage threw: perched only, no arrival. */
  storageOk: boolean;
};

export type VisitorPlan = "none" | "perched" | "arrive";

/**
 * What to show for this band today:
 * - the toggle is off, or a tap sent it away for this band: nothing;
 * - storage unavailable, reduced motion, or the arrival already played for
 *   this band: perched (still);
 * - otherwise: the arrival, once.
 */
export function planVisitor(
  state: VisitorState,
  today: string,
  band: TimeBand,
  reducedMotion: boolean,
): VisitorPlan {
  const stamp = bandStamp(today, band);
  if (state.off === "1") return "none";
  if (state.away === stamp) return "none";
  if (!state.storageOk || reducedMotion) return "perched";
  return state.seen === stamp ? "perched" : "arrive";
}

/** Reads the three keys. Never throws: a blocked store is `storageOk: false`. */
export function readVisitorState(storage: () => Storage = () => window.localStorage): VisitorState {
  try {
    const s = storage();
    return {
      seen: s.getItem(VISITOR_SEEN_KEY),
      away: s.getItem(VISITOR_AWAY_KEY),
      off: s.getItem(VISITORS_OFF_KEY),
      storageOk: true,
    };
  } catch {
    return { seen: null, away: null, off: null, storageOk: false };
  }
}

/** A write that can't happen is a write that doesn't: the visitor stays perched next time. */
export function writeVisitorKey(
  key: typeof VISITOR_SEEN_KEY | typeof VISITOR_AWAY_KEY | typeof VISITORS_OFF_KEY,
  value: string | null,
  storage: () => Storage = () => window.localStorage,
): boolean {
  try {
    const s = storage();
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

// --- Room ----------------------------------------------------------------------

export type Box = { left: number; top: number; right: number; bottom: number };

/** Clear space kept around the visitor's whole flight path. */
export const VISITOR_CLEARANCE_PX = 8;

/**
 * Whether the visitor's envelope (its perch box plus the ground its flight
 * crosses) is clear of every figure, line of text and control. Any overlap,
 * or closer than the clearance, means it isn't rendered at this width.
 */
export function hasRoom(envelope: Box, others: readonly Box[], clearance = VISITOR_CLEARANCE_PX): boolean {
  return others.every(
    (o) =>
      o.right + clearance <= envelope.left ||
      o.left - clearance >= envelope.right ||
      o.bottom + clearance <= envelope.top ||
      o.top - clearance >= envelope.bottom,
  );
}
