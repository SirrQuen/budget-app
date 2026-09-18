import { addDaysISO } from "@/lib/date";

export type StreakDayStatus = "earned" | "grace" | "today-pending" | "unearned";

export interface StreakSegment {
  /** "YYYY-MM-DD", local calendar day. */
  date: string;
  status: StreakDayStatus;
  /** True for exactly one segment -- lets consumers identify today without
   * re-deriving it, since "earned" alone doesn't distinguish today from any
   * other logged day once today's been logged too. */
  isToday: boolean;
}

export interface LoggingStreakSummary {
  /** Consecutive covered days ending today (if today's already covered) or
   * yesterday (if today's still pending) -- pending never counts as a break. */
  current: number;
  /** Longest consecutive run within the dates supplied, current included. */
  longest: number;
  /** Current calendar week, Monday through Sunday. */
  segments: StreakSegment[];
  loggedToday: boolean;
}

const MILESTONES = [7, 30, 100, 365] as const;
export type StreakMilestone = (typeof MILESTONES)[number];

/** Non-null only on the one calendar day `current` first reaches that value --
 * current rises by at most one per day while unbroken, so no separate
 * "just reached" flag is needed to avoid re-firing on a later, higher day. */
export function milestoneReached(current: number): StreakMilestone | null {
  return (MILESTONES as readonly number[]).includes(current) ? (current as StreakMilestone) : null;
}

/**
 * Pure and derived, not stored -- see CLAUDE.md's storage note. `activeDates`
 * is transaction_date values unioned with explicit "nothing to log" days;
 * `graceDates` is the small ledger of grace days already applied (a separate,
 * append-only record so a disclosed "we covered Tuesday for you" never
 * silently flips back to "earned" if a transaction is later backdated onto
 * that day). Allocating NEW grace (the 2-per-calendar-month budget) is a
 * write-time decision made elsewhere, lazily, the same way recurring
 * transactions are generated -- this function only renders whatever ledger
 * it's handed.
 *
 * All three date inputs must already be local-calendar-day strings
 * ("YYYY-MM-DD"). Never pass a UTC-parsed Date through here -- see
 * lib/date.ts's parseLocalDate comment on the Phase 6 bug this avoids.
 */
export function deriveLoggingStreak(
  activeDates: string[],
  graceDates: string[],
  todayISO: string,
): LoggingStreakSummary {
  const grace = new Set(graceDates);
  const covered = new Set([...activeDates, ...graceDates]);

  const loggedToday = covered.has(todayISO);

  let current = 0;
  let cursor = loggedToday ? todayISO : addDaysISO(todayISO, -1);
  while (covered.has(cursor)) {
    current += 1;
    cursor = addDaysISO(cursor, -1);
  }

  const sorted = [...covered].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const date of sorted) {
    run = prev !== null && addDaysISO(prev, 1) === date ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = date;
  }
  longest = Math.max(longest, current);

  const monday = mondayOfWeek(todayISO);
  const segments: StreakSegment[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDaysISO(monday, i);
    let status: StreakDayStatus;
    if (date === todayISO && !loggedToday) status = "today-pending";
    else if (grace.has(date)) status = "grace";
    else if (covered.has(date)) status = "earned";
    else status = "unearned";
    segments.push({ date, status, isToday: date === todayISO });
  }

  return { current, longest, segments, loggedToday };
}

/** Monday of the calendar week `dateISO` falls in ("YYYY-MM-DD" in, same).
 * Local-calendar-day arithmetic throughout, matching addDaysISO -- never
 * routes through a UTC-parsed Date. */
function mondayOfWeek(dateISO: string): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).getDay(); // 0 Sun .. 6 Sat
  const deltaToMonday = weekday === 0 ? -6 : 1 - weekday;
  return addDaysISO(dateISO, deltaToMonday);
}

/** "4 weeks current" once `current` lands on a whole week, else "N days
 * current" -- exact multiples only, so a partial week never hides days. */
export function formatCurrentPhrase(current: number): string {
  if (current > 0 && current % 7 === 0) {
    const weeks = current / 7;
    return `${weeks} week${weeks === 1 ? "" : "s"} current`;
  }
  return `${current} day${current === 1 ? "" : "s"} current`;
}

export function formatLongestPhrase(longest: number): string {
  return `longest ${longest} day${longest === 1 ? "" : "s"}`;
}

/**
 * The one line of text under the mark row/ring. Leads with the achievement
 * on a broken streak rather than "0 days" -- a plain reset stated once,
 * never a countdown or a loss framing (CLAUDE.md tone rules).
 */
export function formatStreakLine(current: number, longest: number): string {
  if (current === 0 && longest > 0) {
    return `Longest run ${longest} day${longest === 1 ? "" : "s"} · starting again today`;
  }
  if (current === 0) {
    return "Log today to start a streak";
  }
  return `${formatCurrentPhrase(current)} · ${formatLongestPhrase(longest)}`;
}
