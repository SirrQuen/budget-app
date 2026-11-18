// Onboarding that grows (docs/Decide-and-Grow.md, G), pure.
//
// Which step to show is worked out from what exists -- never a stored flag:
//   no account                                   -> step 1 (an account)
//   an account, no transactions, no income
//   schedule, and the payday step not skipped    -> step 2 (a paycheck)
// Step 3 (the number) is never derived: it is the response of the step-2
// answer, so it shows once, to the person who just answered.
//
// Step 2 appears only while there are no transactions at all, so someone
// already using Sorrel without a paycheck schedule never sees onboarding.

import { addDaysISO, endOfMonthISO } from "@/lib/date";
import type { DashboardStage } from "@/lib/db/dashboard";

export type OnboardingStep = 1 | 2;

/**
 * New since onboarding shipped: anyone whose first account is older has
 * been using Sorrel without it, and never sees the payday step or the bills
 * card (ruled 2026-11-18: "Existing users never see onboarding"). One
 * cutoff for both, so they can't disagree about who is new.
 */
export const NEW_USERS_FROM = "2026-11-18T00:00:00Z";

/** Whether a first account created at this instant belongs to someone new. */
export function isNewSince(firstAccountCreatedAt: string | null): boolean {
  if (firstAccountCreatedAt === null) return false;
  const t = Date.parse(firstAccountCreatedAt);
  return !Number.isNaN(t) && t >= Date.parse(NEW_USERS_FROM);
}

export function onboardingStep(input: {
  stage: DashboardStage;
  anyIncome: boolean;
  skippedPayday: boolean;
  /** The first account's created_at; step 2 is only for someone new (NEW_USERS_FROM). */
  firstAccountCreatedAt: string | null;
}): OnboardingStep | null {
  if (input.stage === "no-accounts") return 1;
  if (
    input.stage === "no-transactions" &&
    !input.anyIncome &&
    !input.skippedPayday &&
    isNewSince(input.firstAccountCreatedAt)
  ) {
    return 2;
  }
  return null;
}

/** The account types step 1 offers -- the spendable set, so step 3 has a number. */
export const ONBOARDING_ACCOUNT_TYPES = ["Checking", "Cash"] as const;

export type PayFrequency = "weekly" | "every_2_weeks" | "twice_a_month" | "monthly";

export const PAY_FREQUENCIES: { value: PayFrequency; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "every_2_weeks", label: "Every 2 weeks" },
  { value: "twice_a_month", label: "Twice a month" },
  { value: "monthly", label: "Monthly" },
];

/** One payday as asked: a date, or "the last day of the month". */
export type Payday = { date: string; lastDay: boolean };

/** What one schedule needs from the answer; the rest is fixed by the action. */
export type PaycheckSchedulePlan = {
  frequency: "Weekly" | "Monthly";
  interval_count: number;
  next_run_date: string;
  start_date: string;
};

/**
 * "Last day of the month": the anchor a Monthly schedule steps from.
 *
 * A Monthly schedule keeps one day of the month -- start_date's -- and
 * clamps it to short months (lib/recurringCadence.ts). Anchored on the
 * 31st, it lands on every month's last day: Nov 30, Dec 31, Feb 28 (29 in
 * a leap year), Mar 31. Anchored on the first payday itself, a 30th would
 * stay the 30th (Dec 30, Jan 30) and a Feb 28 the 28th forever. So the
 * first payday is the schedule's next date, and start_date is the nearest
 * 31st on or before it. start_date is read ONLY as that anchor -- it is
 * never shown as a start or a first payment (checked 2026-11-17: the
 * recurring row shows "Monthly on the 31st", the edit form never shows it)
 * -- and the one constraint on it, end_date >= start_date, still holds.
 * Ruled 2026-11-17; a real "last day" option is queued with the
 * semi-monthly frequency.
 */
export function lastDayAnchor(firstPayday: string): string {
  let month = firstPayday.slice(0, 7);
  for (let i = 0; i < 12; i++) {
    const end = endOfMonthISO(`${month}-01`);
    if (end.endsWith("-31")) return end;
    month = addDaysISO(`${month}-01`, -1).slice(0, 7);
  }
  // Unreachable: every 12-month window has a 31-day month.
  return firstPayday;
}

/** The next "last day of the month" on or after today: this month's. */
export function nextLastDay(today: string): string {
  return endOfMonthISO(today);
}

function monthlyPlan(p: Payday): PaycheckSchedulePlan {
  return p.lastDay
    ? { frequency: "Monthly", interval_count: 1, next_run_date: p.date, start_date: lastDayAnchor(p.date) }
    : { frequency: "Monthly", interval_count: 1, next_run_date: p.date, start_date: p.date };
}

/**
 * The schedule(s) a paycheck answer creates. Weekly and every 2 weeks are
 * one Weekly schedule (interval 1 or 2); twice a month is two Monthly
 * schedules, one per payday; monthly is one. Each Monthly payday can be
 * the last day of the month (lastDayAnchor). Returns an error string for
 * an answer that can't be a schedule.
 */
export function paycheckPlans(
  frequency: PayFrequency,
  paydays: Payday[],
  today: string,
): PaycheckSchedulePlan[] | { error: string } {
  const first = paydays[0];
  if (!first || !first.date) return { error: "Choose your next payday." };
  for (const p of paydays) {
    if (!p.date) return { error: "Choose both paydays." };
    if (p.date < today) return { error: "Choose a payday from today on." };
    if (p.date > addDaysISO(today, 62)) return { error: "Choose your next payday, in the next two months." };
    if (p.lastDay && p.date !== endOfMonthISO(p.date)) return { error: "Choose a month's last day for that payday." };
  }

  switch (frequency) {
    case "weekly":
    case "every_2_weeks": {
      const interval = frequency === "weekly" ? 1 : 2;
      if (first.date > addDaysISO(today, 7 * interval)) {
        return { error: interval === 1 ? "Choose a payday in the next week." : "Choose a payday in the next two weeks." };
      }
      return [{ frequency: "Weekly", interval_count: interval, next_run_date: first.date, start_date: first.date }];
    }
    case "monthly":
      return [monthlyPlan(first)];
    case "twice_a_month": {
      const second = paydays[1];
      if (!second || !second.date) return { error: "Choose both paydays." };
      const dayOf = (p: Payday) => (p.lastDay ? 31 : Number(p.date.slice(8, 10)));
      if (dayOf(first) === dayOf(second)) return { error: "Choose two different paydays in the month." };
      return [monthlyPlan(first), monthlyPlan(second)];
    }
  }
}
