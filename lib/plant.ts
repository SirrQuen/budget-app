import { addDaysISO } from "@/lib/date";
import { MARK_DAY_START, hourInZone, markStateForHour } from "@/lib/timeOfDay";

// The dashboard's roselle (docs/Roselle.md): open 7:00-18:59, closed
// 19:00-6:59, in the user's stored zone. The hours are lib/timeOfDay's
// (MARK_DAY_START / MARK_NIGHT_START) -- one clock, never a second one. It
// plays its change once per device: "sorrel-plant-seen" holds
// `<date>:<open|closed>`, and a visit whose stamp differs plays; a visit
// whose stamp matches rests. Display only: nothing here touches the
// database, and a render writes nothing (the component writes when a play
// actually starts).

export type PlantState = "open" | "closed";

export const PLANT_SEEN_KEY = "sorrel-plant-seen";

/** Opening and closing both take this long (app/globals.css, --roselle-duration). */
export const PLANT_PLAY_MS = 1600;

export function plantStateForHour(hour: number): PlantState {
  return markStateForHour(hour) === "open" ? "open" : "closed";
}

/** The pose for `now` in the user's stored zone; null or an unknown zone is UTC. */
export function plantStateAt(timeZone: string | null, now: Date): PlantState {
  return plantStateForHour(hourInZone(timeZone, now));
}

export function otherPlantState(state: PlantState): PlantState {
  return state === "open" ? "closed" : "open";
}

/**
 * The stamp for the change in force at `hour` on the user's day `today`. The
 * small hours (0:00-6:59) belong to the night that began the evening before,
 * so 00:30 does not look like a new change after the 19:00 close was seen.
 */
export function plantStamp(today: string, hour: number): string {
  const state = plantStateForHour(hour);
  const day = state === "closed" && hour < MARK_DAY_START ? addDaysISO(today, -1) : today;
  return `${day}:${state}`;
}

export type PlantPlan = "rest" | "play";

/**
 * Play only when this device has not yet seen this change. `stored` is what
 * storage held: a string, null (never written), or undefined when storage
 * could not be read at all -- which rests, never animates. Reduced motion
 * rests, always.
 */
export function planPlant(stored: string | null | undefined, stamp: string, reducedMotion: boolean): PlantPlan {
  if (reducedMotion || stored === undefined) return "rest";
  return stored === stamp ? "rest" : "play";
}

/** undefined when storage can't be read (blocked, private mode, a throwing accessor). */
export function readPlantSeen(storage: () => Storage = () => window.localStorage): string | null | undefined {
  try {
    return storage().getItem(PLANT_SEEN_KEY);
  } catch {
    return undefined;
  }
}

/** False when the write failed -- the caller then rests rather than play a change it can't remember. */
export function writePlantSeen(stamp: string, storage: () => Storage = () => window.localStorage): boolean {
  try {
    storage().setItem(PLANT_SEEN_KEY, stamp);
    return true;
  } catch {
    return false;
  }
}
