// "First one today" (docs/Motion-and-Delight.md, step 3): derived from the
// save, never stored. Were there other transactions CREATED today, in the
// user's zone, before this one? `latestOtherCreatedAt` is the newest
// created_at among every transaction except the one(s) just saved, or null
// when there are none (the very first transaction is also the first of its
// day). `today` is the user's calendar day.
//
// Created, not dated: a backdated entry is still the first thing logged
// today. Nothing here counts days or looks at yesterday.

import { todayInZone } from "@/lib/date";

export function isFirstSaveOfDay(
  latestOtherCreatedAt: string | null,
  today: string,
  timeZone: string | null,
): boolean {
  if (latestOtherCreatedAt === null) return true;
  const created = new Date(latestOtherCreatedAt);
  if (Number.isNaN(created.getTime())) return false;
  return todayInZone(timeZone, created) !== today;
}
