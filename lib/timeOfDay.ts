import { todayInZone } from "@/lib/date";

// Time of day and season, in the user's own zone (docs/Motion-and-Delight.md,
// step 8). Pure: every function takes the zone and the instant, so the
// dashboard renders on the server with no flash and nothing is stored. The
// zone is settings.timezone (getTimeZone() in lib/db/settings.ts), the same
// one balances use; null or an unknown name is UTC, as everywhere else.
//
// THE greeting phrase lives here. The dashboard header (welcomeMessage in
// lib/displayName.ts) and the sign-in splash (dailyGreeting in lib/welcome.ts)
// both build on greetingPhrase(); neither writes its own.

export type TimeBand = "morning" | "afternoon" | "evening" | "night";

/** The wall clock in `timeZone` (hour 0-23); UTC if the zone is unknown. */
export function wallClockInZone(
  timeZone: string | null,
  now: Date,
): { hour: number; minute: number; second: number } {
  const read = (zone: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
    return { hour: get("hour"), minute: get("minute"), second: get("second") };
  };
  try {
    return read(timeZone ?? "UTC");
  } catch {
    return read("UTC");
  }
}

/** The wall-clock hour (0-23) in `timeZone`; UTC if it's unknown. */
export function hourInZone(timeZone: string | null, now: Date): number {
  return wallClockInZone(timeZone, now).hour;
}

/**
 * 5am-noon morning, noon-5pm afternoon, 5pm-10pm evening, 10pm-5am night.
 * Each band starts on its first minute: 4:59 is night, 5:00 morning.
 */
export function timeBand(hour: number): TimeBand {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

export function timeBandAt(timeZone: string | null, now: Date): TimeBand {
  return timeBand(hourInZone(timeZone, now));
}

const PHRASE: Record<TimeBand, string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
  night: "Hi, night owl",
};

/** The greeting for a band, with no name and no punctuation after it. */
export function greetingPhrase(band: TimeBand): string {
  return PHRASE[band];
}

/** "Good morning, Matt" -- but "Hi, night owl" already addresses them, so no name is added. */
export function greetingWithName(band: TimeBand, name: string | null): string {
  return name && band !== "night" ? `${PHRASE[band]}, ${name}` : PHRASE[band];
}

export type Season = "spring" | "summer" | "autumn" | "winter";

/** Northern hemisphere, by month 1-12. A hemisphere setting is queued (docs/queue.md). */
export function seasonForMonth(month: number): Season {
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

/** The month (1-12) in `timeZone`, read from the same calendar day getToday() names. */
export function monthInZone(timeZone: string | null, now: Date): number {
  return Number(todayInZone(timeZone, now).slice(5, 7));
}

export function seasonAt(timeZone: string | null, now: Date): Season {
  return seasonForMonth(monthInZone(timeZone, now));
}

// The dashboard flower (components/DayNightMark.tsx): open 7:00am-6:59pm,
// folded 7:00pm-6:59am, on the SAME hour as the glow above -- the user's
// stored zone, never the browser's clock. These hours are the flower's own;
// they are not the greeting's bands.
export type MarkState = "open" | "folded";

export const MARK_DAY_START = 7;
export const MARK_NIGHT_START = 19;

export function markStateForHour(hour: number): MarkState {
  return hour >= MARK_DAY_START && hour < MARK_NIGHT_START ? "open" : "folded";
}

export function markStateAt(timeZone: string | null, now: Date): MarkState {
  return markStateForHour(hourInZone(timeZone, now));
}

/**
 * Milliseconds until the wall clock in `timeZone` next reads 7:00 or 19:00.
 * Always positive: exactly on a boundary, the answer is the one after it. A
 * daylight-saving change can make the real wait an hour off for that one
 * night; the caller re-reads the state when the timer fires and re-arms, so
 * it only ever lands early or late once.
 */
export function msUntilNextMarkBoundary(timeZone: string | null, now: Date): number {
  const { hour, minute, second } = wallClockInZone(timeZone, now);
  const secondsIntoDay = hour * 3600 + minute * 60 + second;
  const day = 24 * 3600;
  const next =
    [MARK_DAY_START * 3600, MARK_NIGHT_START * 3600].find((b) => b > secondsIntoDay) ?? MARK_DAY_START * 3600 + day;
  return (next - secondsIntoDay) * 1000 - now.getUTCMilliseconds();
}
