// Which milestones THIS DEVICE has already celebrated (docs/Decide-and-Grow.md,
// J). A per-device convenience in localStorage, every access in try/catch;
// nothing reaches the database. Two keys:
//   milestones-celebrated   JSON array of milestone ids
//   milestones-initialised  set the first time the dashboard syncs on this
//                           device: everything ALREADY earned is marked
//                           celebrated then, silently, so an existing user
//                           never gets a pile of toasts.

import { isMilestoneId, type MilestoneId } from "@/lib/milestones";

export const CELEBRATED_KEY = "milestones-celebrated";
export const INITIALISED_KEY = "milestones-initialised";

export type DeviceStorage = Pick<Storage, "getItem" | "setItem">;

/** The browser's storage, or null when it is absent or throws (private window, blocked data). */
export function deviceStorage(): DeviceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(storage: DeviceStorage): Set<MilestoneId> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(CELEBRATED_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter(isMilestoneId) : []);
  } catch {
    return new Set();
  }
}

function write(storage: DeviceStorage, ids: Set<MilestoneId>): boolean {
  try {
    storage.setItem(CELEBRATED_KEY, JSON.stringify([...ids]));
    return true;
  } catch {
    return false;
  }
}

/**
 * Claim a celebration for a milestone a save just crossed: true when it
 * should be celebrated now. Already celebrated here: false. Storage
 * unavailable: true -- the response that carries it exists only for the
 * crossing save, so it can't repeat.
 */
export function claimCelebration(id: MilestoneId, storage: DeviceStorage | null = deviceStorage()): boolean {
  if (storage === null) return true;
  const seen = read(storage);
  if (seen.has(id)) return false;
  seen.add(id);
  write(storage, seen);
  return true;
}

/**
 * The dashboard's sync. First run on this device: mark everything earned as
 * celebrated and celebrate nothing. After that: the earned ones not yet
 * celebrated here, marked as they are returned. Storage unavailable:
 * nothing -- without a record it would repeat on every load.
 */
export function syncCelebrations(earnedIds: MilestoneId[], storage: DeviceStorage | null = deviceStorage()): MilestoneId[] {
  if (storage === null) return [];
  try {
    const seen = read(storage);
    if (storage.getItem(INITIALISED_KEY) === null) {
      for (const id of earnedIds) seen.add(id);
      if (!write(storage, seen)) return [];
      storage.setItem(INITIALISED_KEY, "1");
      return [];
    }
    const fresh = earnedIds.filter((id) => !seen.has(id));
    if (fresh.length === 0) return [];
    for (const id of fresh) seen.add(id);
    return write(storage, seen) ? fresh : [];
  } catch {
    return [];
  }
}
