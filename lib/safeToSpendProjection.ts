// The safe-to-spend calculation itself, pure and database-free so every
// case can be unit tested (lib/safeToSpendProjection.test.ts).
// lib/db/dashboard.ts's getSafeToSpend only gathers the inputs and hands
// them here.
//
// Project forward, take the minimum:
//
//   1. Start from today's cash -- active Checking + Savings balances.
//   2. Walk day by day to the horizon: max(35 days out, the payday after
//      next). On each day, obligations leave first, then income lands, so
//      a same-day bill and paycheck never let the paycheck hide the bill.
//   3. The lowest balance reached is the trough. safe = trough - cushion,
//      floored at zero.
//
// Both estimates push the trough DOWN:
//   - income counts on the LATE edge of its date tolerance
//     (paydayWindowEnd) at its LOW amount estimate;
//   - obligations count on the EARLY edge (expenseCommitmentDate) at their
//     expected amount.
//
// Which rows are income and which are obligations is not decided here --
// isSpendableAccountType / isSafeToSpendCommitment (lib/safeToSpend.ts)
// are reused unchanged, including the Checking -> Savings exclusion.
//
// With no usable income schedule there's no payday to project to, so the
// caller's window (next payday / end of month / 30 days, from settings)
// is used as the horizon with no income in it -- which reduces exactly to
// the old "cash minus everything due in the window", minus the cushion.
//
// All money is integer cents internally; dollars only at the edges.

import { addDaysISO, daysBetweenInclusive } from "@/lib/date";
import { resolveDueDate, type NonBusinessDayRule } from "@/lib/businessDays";
import { nextOccurrenceISO } from "@/lib/recurringCadence";
import { expenseCommitmentDate, paydayWindowEnd } from "@/lib/recurringSchedule";
import { isSafeToSpendCommitment, isSpendableAccountType } from "@/lib/safeToSpend";

/** Minimum projection length, in days past today. */
export const MIN_HORIZON_DAYS = 35;

// How far ahead to look for paydays at all. A schedule with nothing inside
// a year (a paused-then-ended one, say) isn't a usable income schedule.
const PAYDAY_SEARCH_DAYS = 366;

// rectx_date_tolerance_range's ceiling -- an obligation whose due date
// sits up to this far past the horizon can still land inside it via its
// early edge.
const MAX_DATE_TOLERANCE_DAYS = 14;

// Backstop against a malformed schedule looping forever.
const MAX_OCCURRENCES_PER_SCHEDULE = 400;

export type ProjectionSchedule = {
  recurringId: string;
  name: string;
  /** Income/Expense for a category schedule, Transfer for a transfer template. */
  kind: "Income" | "Expense" | "Transfer";
  /** accountid's type -- where Income lands, where an outflow leaves from. */
  fromAccountType: string;
  /** to_accountid's type for a Transfer; null otherwise. */
  toAccountType: string | null;
  /** Expected amount per occurrence, dollars (v_upcoming_recurring.amount). */
  amount: number;
  /** Low estimate, dollars -- only read for Income. Null means "same as amount". */
  amountLow: number | null;
  isEstimate: boolean;
  /** Raw cadence cursor (next_run_date) -- stepped, never business-day shifted. */
  nextRunDate: string;
  /** Resolved date of the next occurrence (next_due_date). */
  nextDueDate: string;
  /** start_date -- the day-of-month anchor for Monthly/Quarterly/Yearly. */
  anchorDate: string;
  frequency: string;
  intervalCount: number;
  businessDayOffset: number;
  nonBusinessDayRule: NonBusinessDayRule;
  dateToleranceDays: number;
  endDate: string | null;
  /** occurrence_limit minus occurrences already posted; null when uncapped. */
  occurrencesRemaining: number | null;
};

export type ProjectedObligation = {
  recurringId: string;
  name: string;
  /** Positive outflow, dollars. */
  amount: number;
  /** The day the projection subtracts it -- the early edge, never before today. */
  date: string;
  isEstimate: boolean;
};

export type ProjectedIncome = {
  recurringId: string;
  name: string;
  /** Low estimate, dollars. */
  amount: number;
  /** The day the projection adds it -- the late edge of its tolerance. */
  date: string;
  isEstimate: boolean;
};

export type HorizonReason =
  /** Projection ran through the payday after next. */
  | "payday_after_next"
  /** Projection ran the 35-day minimum (the payday after next came sooner). */
  | "minimum"
  /** No usable income schedule -- the caller's window, no income counted. */
  | "window";

export type SafeToSpendProjectionInput = {
  today: string;
  /** Active Checking + Savings balances, dollars. */
  cash: number;
  /** Dollars, >= 0. */
  cushion: number;
  schedules: ProjectionSchedule[];
  holidays: ReadonlySet<string>;
  /** Horizon to use when there's no usable income schedule. */
  fallbackWindowEnd: string;
};

export type SafeToSpendProjection = {
  mode: "projection" | "window";
  horizonEnd: string;
  horizonReason: HorizonReason;
  /** Calendar days from today through horizonEnd, inclusive. */
  daysRemaining: number;
  cashOnHand: number;
  cushion: number;
  /** The lowest projected balance, the day it happens, and what lands that day. */
  trough: { amount: number; date: string; obligations: ProjectedObligation[] };
  /** Every obligation inside the horizon, date order. */
  obligations: ProjectedObligation[];
  /** Every income occurrence counted, date order. Empty in window mode. */
  incomes: ProjectedIncome[];
  /** max(0, trough - cushion). */
  safeToSpend: number;
  /** Set when the trough itself goes below zero -- how far, and when. */
  shortfall: { amount: number; date: string } | null;
  /** safeToSpend spread over daysRemaining; null when safeToSpend is 0. */
  perDay: number | null;
  /**
   * Paychecks left OUT of the maths because their latest possible date
   * has passed without a confirmation -- one per schedule, its earliest
   * missed occurrence (the one confirming acts on). Surfaced so a low
   * figure has a findable cause.
   */
  unconfirmedIncome: OverdueOccurrence[];
  /**
   * Obligations past their due date that haven't posted -- subtracted
   * today, and surfaced for the same reason. One per schedule, earliest.
   */
  overdueObligations: OverdueOccurrence[];
};

export type OverdueOccurrence = {
  recurringId: string;
  name: string;
  /** Expected amount, dollars. */
  amount: number;
  /** The resolved due date that was missed. */
  dueDate: string;
  isEstimate: boolean;
};

const toCents = (dollars: number) => Math.round(dollars * 100);
const toDollars = (cents: number) => cents / 100;

// Every resolved due date of a schedule, starting with its stored
// next_due_date, until one passes `until`. Mirrors generateDueOccurrences'
// loop (lib/db/recurring.ts): the raw cursor steps, the resolved date is
// derived, end_date is checked against the raw cursor.
function expandDueDates(s: ProjectionSchedule, until: string, holidays: ReadonlySet<string>): string[] {
  const out: string[] = [];
  let cursor = s.nextRunDate;
  let due = s.nextDueDate;
  let remaining = s.occurrencesRemaining ?? Infinity;

  while (remaining > 0 && out.length < MAX_OCCURRENCES_PER_SCHEDULE) {
    if (s.endDate && cursor > s.endDate) break;
    if (due > until) break;
    out.push(due);
    remaining -= 1;
    cursor = nextOccurrenceISO(cursor, s.frequency, s.intervalCount, s.anchorDate);
    due = resolveDueDate(cursor, s.businessDayOffset, s.nonBusinessDayRule, holidays);
  }

  return out;
}

function isIncomeSchedule(s: ProjectionSchedule): boolean {
  return s.kind === "Income" && isSpendableAccountType(s.fromAccountType);
}

function isObligationSchedule(s: ProjectionSchedule): boolean {
  return (
    s.kind !== "Income" &&
    isSafeToSpendCommitment({
      transactionType: s.kind,
      fromAccountType: s.fromAccountType,
      toAccountType: s.toAccountType,
    })
  );
}

function overdue(s: ProjectionSchedule, dueDate: string): OverdueOccurrence {
  return {
    recurringId: s.recurringId,
    name: s.name,
    amount: s.amount,
    dueDate,
    isEstimate: s.isEstimate,
  };
}

export function projectSafeToSpend(input: SafeToSpendProjectionInput): SafeToSpendProjection {
  const { today, schedules, holidays } = input;

  // Income, at the late edge. An occurrence whose late edge has already
  // passed is an unconfirmed paycheck -- never assumed to have arrived
  // (CLAUDE.md "Confirm inflows"), so it isn't counted and isn't a payday.
  const paydaySearchEnd = addDaysISO(today, PAYDAY_SEARCH_DAYS);
  const allIncomes: ProjectedIncome[] = [];
  const unconfirmedIncome: OverdueOccurrence[] = [];
  for (const s of schedules.filter(isIncomeSchedule)) {
    for (const due of expandDueDates(s, paydaySearchEnd, holidays)) {
      const date = paydayWindowEnd(due, s.dateToleranceDays);
      if (date < today) {
        // Due dates come out in order, so the first one seen is the
        // earliest -- the occurrence confirming acts on.
        if (!unconfirmedIncome.some((u) => u.recurringId === s.recurringId)) {
          unconfirmedIncome.push(overdue(s, due));
        }
        continue;
      }
      allIncomes.push({
        recurringId: s.recurringId,
        name: s.name,
        amount: s.amountLow ?? s.amount,
        date,
        isEstimate: s.isEstimate || (s.amountLow !== null && s.amountLow !== s.amount),
      });
    }
  }
  allIncomes.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Two schedules paying on the same day are one payday.
  const paydays = [...new Set(allIncomes.map((i) => i.date))];

  let mode: SafeToSpendProjection["mode"];
  let horizonEnd: string;
  let horizonReason: HorizonReason;
  if (paydays.length === 0) {
    mode = "window";
    horizonEnd = input.fallbackWindowEnd;
    horizonReason = "window";
  } else {
    mode = "projection";
    const paydayAfterNext = paydays[1] ?? paydays[0];
    const minimumEnd = addDaysISO(today, MIN_HORIZON_DAYS);
    if (paydayAfterNext > minimumEnd) {
      horizonEnd = paydayAfterNext;
      horizonReason = "payday_after_next";
    } else {
      horizonEnd = minimumEnd;
      horizonReason = "minimum";
    }
  }

  const incomes = mode === "projection" ? allIncomes.filter((i) => i.date <= horizonEnd) : [];

  // Obligations, at the early edge, never before today (an overdue one
  // that hasn't posted yet still has to come out of today's cash).
  const obligations: ProjectedObligation[] = [];
  const overdueObligations: OverdueOccurrence[] = [];
  const obligationSearchEnd = addDaysISO(horizonEnd, MAX_DATE_TOLERANCE_DAYS);
  for (const s of schedules.filter(isObligationSchedule)) {
    for (const due of expandDueDates(s, obligationSearchEnd, holidays)) {
      if (due < today && !overdueObligations.some((o) => o.recurringId === s.recurringId)) {
        overdueObligations.push(overdue(s, due));
      }
      const early = expenseCommitmentDate(due, s.dateToleranceDays);
      const date = early < today ? today : early;
      if (date > horizonEnd) continue;
      obligations.push({
        recurringId: s.recurringId,
        name: s.name,
        amount: s.amount,
        date,
        isEstimate: s.isEstimate,
      });
    }
  }
  obligations.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Day-by-day walk. Outflows before inflows within a day; the earliest
  // day wins a tie for the trough.
  const outByDay = new Map<string, ProjectedObligation[]>();
  for (const o of obligations) {
    outByDay.set(o.date, [...(outByDay.get(o.date) ?? []), o]);
  }
  const inByDay = new Map<string, number>();
  for (const i of incomes) {
    inByDay.set(i.date, (inByDay.get(i.date) ?? 0) + toCents(i.amount));
  }

  const cashCents = toCents(input.cash);
  let balance = cashCents;
  let troughCents = cashCents;
  let troughDate = today;
  let troughObligations: ProjectedObligation[] = [];

  for (let day = today; day <= horizonEnd; day = addDaysISO(day, 1)) {
    const out = outByDay.get(day);
    if (out) {
      balance -= out.reduce((sum, o) => sum + toCents(o.amount), 0);
      if (balance < troughCents) {
        troughCents = balance;
        troughDate = day;
        troughObligations = out;
      }
    }
    balance += inByDay.get(day) ?? 0;
  }

  const cushionCents = Math.max(0, toCents(input.cushion));
  const safeCents = Math.max(0, troughCents - cushionCents);
  const daysRemaining = daysBetweenInclusive(today, horizonEnd);

  return {
    mode,
    horizonEnd,
    horizonReason,
    daysRemaining,
    cashOnHand: toDollars(cashCents),
    cushion: toDollars(cushionCents),
    trough: { amount: toDollars(troughCents), date: troughDate, obligations: troughObligations },
    obligations,
    incomes,
    safeToSpend: toDollars(safeCents),
    shortfall: troughCents < 0 ? { amount: toDollars(-troughCents), date: troughDate } : null,
    perDay: safeCents > 0 ? safeCents / daysRemaining / 100 : null,
    unconfirmedIncome,
    overdueObligations,
  };
}
