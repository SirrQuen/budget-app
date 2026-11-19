// Lifetime milestones (docs/Decide-and-Grow.md, J). Pure: what the set is,
// how each is worded and dated. Everything is DERIVED on read from rows that
// already exist (lib/db/milestones.ts) -- nothing is stored. Never about
// amounts, never a comparison, never a locked list: only earned ones exist.

import { todayInZone } from "@/lib/date";

/** The log counts that are milestones. A log is hand-logged or queue-confirmed, never imported. */
export const LOG_THRESHOLDS = [1, 10, 100, 500, 1000] as const;

export type MilestoneId =
  | "log-1"
  | "log-10"
  | "log-100"
  | "log-500"
  | "log-1000"
  | "first-import"
  | "first-goal"
  | "first-goal-reached"
  | "month-1"
  | "month-3"
  | "year-1";

export type EarnedMilestone = {
  id: MilestoneId;
  label: string;
  /** The user's calendar day, "YYYY-MM-DD". */
  date: string;
};

const LABELS: Record<MilestoneId, string> = {
  "log-1": "Your first log",
  "log-10": "Your 10th log",
  "log-100": "Your 100th log",
  "log-500": "Your 500th log",
  "log-1000": "Your 1,000th log",
  "first-import": "Your first import",
  "first-goal": "Your first goal set",
  "first-goal-reached": "Your first goal reached",
  "month-1": "One month with Sorrel",
  "month-3": "Three months with Sorrel",
  "year-1": "One year with Sorrel",
};

// The order milestones sort in when two share a day.
const ORDER = Object.keys(LABELS) as MilestoneId[];

export function milestoneLabel(id: MilestoneId): string {
  return LABELS[id];
}

export function logMilestoneId(threshold: number): MilestoneId | null {
  return (LOG_THRESHOLDS as readonly number[]).includes(threshold) ? (`log-${threshold}` as MilestoneId) : null;
}

export function isMilestoneId(value: unknown): value is MilestoneId {
  return typeof value === "string" && (ORDER as string[]).includes(value);
}

/** The user's day an instant falls on, in their zone (null = UTC). Unreadable input: null. */
export function dateInZone(instant: string, timeZone: string | null): string | null {
  const at = new Date(instant);
  return Number.isNaN(at.getTime()) ? null : todayInZone(timeZone, at);
}

/** Whole calendar months after `dateISO`, clamped to the month's last day (Jan 31 + 1 month = Feb 28). */
export function addMonthsISO(dateISO: string, months: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const yyyy = first.getUTCFullYear();
  const mm = String(first.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** One month, three months, one year with Sorrel -- from when the account was created, earned once `today` reaches it. */
export function timeMilestones(createdAt: string, today: string, timeZone: string | null): EarnedMilestone[] {
  const start = dateInZone(createdAt, timeZone);
  if (start === null) return [];
  const steps: [MilestoneId, number][] = [
    ["month-1", 1],
    ["month-3", 3],
    ["year-1", 12],
  ];
  return steps.flatMap(([id, months]) => {
    const date = addMonthsISO(start, months);
    return date <= today ? [{ id, label: LABELS[id], date }] : [];
  });
}

export function earned(id: MilestoneId, instant: string | null, timeZone: string | null): EarnedMilestone[] {
  const date = instant === null ? null : dateInZone(instant, timeZone);
  return date === null ? [] : [{ id, label: LABELS[id], date }];
}

/** Oldest first; a shared day keeps the set's own order. */
export function sortEarned(list: EarnedMilestone[]): EarnedMilestone[] {
  return [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : ORDER.indexOf(a.id) - ORDER.indexOf(b.id)));
}
