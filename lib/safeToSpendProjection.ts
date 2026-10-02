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
//     expected amount. A variable card payment's later occurrences are
//     priced from that card's charges per statement cycle, never by
//     repeating the next payment's figure (see cardPaymentCents).
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
import { expenseCommitmentDate, paydayWindowEnd, statementDateForCycle } from "@/lib/recurringSchedule";
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
  /** accountid -- matches a card's recurring charges to its payment. */
  accountId: string;
  /** accountid's type -- where Income lands, where an outflow leaves from. */
  fromAccountType: string;
  /** to_accountid for a Transfer; null otherwise. */
  toAccountId: string | null;
  /** to_accountid's type for a Transfer; null otherwise. */
  toAccountType: string | null;
  /** The card's statement day-of-month, for a variable card payment. */
  statementDay: number | null;
  /**
   * Set only for a variable-amount card payment (amount_is_variable with a
   * to_accountid). `amount` is then the NEXT payment only -- the confirmed
   * statement amount, or the whole balance owed when unconfirmed -- and
   * later occurrences are built from the card's own charges instead.
   */
  cardPayment: {
    amountConfirmed: boolean;
    /** What the card owes today, dollars, >= 0. */
    balanceOwed: number;
  } | null;
  /**
   * Expected amount per occurrence, dollars (v_upcoming_recurring.amount).
   * For a variable card payment, the next occurrence's amount only.
   */
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
  /**
   * The occurrence's own due date. With recurringId this identifies the
   * row: `date` can't, since every past-due occurrence clamps to today.
   */
  dueDate: string;
  isEstimate: boolean;
};

export type ProjectedIncome = {
  recurringId: string;
  name: string;
  /** Low estimate, dollars. */
  amount: number;
  /** The day the projection adds it -- the late edge of its tolerance. */
  date: string;
  /** The occurrence's own due date -- with recurringId, the row's identity. */
  dueDate: string;
  isEstimate: boolean;
};

/** One day of the walk, dollars. */
export type ProjectedDay = {
  date: string;
  /** After the day's obligations, before its income -- what the trough reads. */
  low: number;
  /** After its income -- what the next day opens on. */
  end: number;
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
  /** Every run below the cushion, chronological. Empty when there are none. */
  episodes: SqueezeEpisode[];
  /** The day-by-day walk, today through horizonEnd. */
  daily: ProjectedDay[];
};

/**
 * A run of consecutive days the projection sits below the cushion. A day
 * is judged at its low -- after its obligations, before its income, the
 * same instant the trough is measured at -- so the trough always falls
 * inside an episode whenever it's below the cushion.
 */
export type SqueezeEpisode = {
  startDate: string;
  endDate: string;
  /** "shortfall" if any day in the run goes below zero, else "tight". */
  severity: "shortfall" | "tight";
  /** Lowest point in the run; earliest day wins a tie, as for the trough. */
  lowPoint: { amount: number; date: string };
  /** Obligations landing inside the run, largest first. */
  drivers: ProjectedObligation[];
  /** The income that lifts the balance back to the cushion; null when open-ended. */
  recovery: { date: string; description: string } | null;
  /** Still below the cushion at the end of the horizon. */
  openEnded: boolean;
  /** This run holds the overall trough. */
  containsTrough: boolean;
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

type Occurrence = {
  /** Raw cadence date -- what statementDateForCycle is keyed on. */
  cursor: string;
  /** Business-day-resolved due date. */
  due: string;
};

// Every occurrence of a schedule, starting with its stored next_due_date,
// until one passes `until`. Mirrors generateDueOccurrences' loop
// (lib/db/recurring.ts): the raw cursor steps, the resolved date is
// derived, end_date is checked against the raw cursor.
function expandOccurrences(s: ProjectionSchedule, until: string, holidays: ReadonlySet<string>): Occurrence[] {
  const out: Occurrence[] = [];
  let cursor = s.nextRunDate;
  let due = s.nextDueDate;
  let remaining = s.occurrencesRemaining ?? Infinity;

  while (remaining > 0 && out.length < MAX_OCCURRENCES_PER_SCHEDULE) {
    if (s.endDate && cursor > s.endDate) break;
    if (due > until) break;
    out.push({ cursor, due });
    remaining -= 1;
    cursor = nextOccurrenceISO(cursor, s.frequency, s.intervalCount, s.anchorDate);
    due = resolveDueDate(cursor, s.businessDayOffset, s.nonBusinessDayRule, holidays);
  }

  return out;
}

function expandDueDates(s: ProjectionSchedule, until: string, holidays: ReadonlySet<string>): string[] {
  return expandOccurrences(s, until, holidays).map((o) => o.due);
}

// Cents for each occurrence of a variable card payment, in order.
//
// A card payment pays one statement cycle. Pricing every occurrence at
// the next payment's figure paid today's balance once per month in the
// horizon. Instead:
//
//   first payment   the confirmed statement amount; or, unconfirmed, the
//                   whole balance owed today plus the card's recurring
//                   charges up to its statement date.
//   later payments  the card's recurring charges dated inside that
//                   payment's statement cycle (previous statement date,
//                   this one]. The second payment also carries what the
//                   card owes beyond a confirmed statement amount -- posted
//                   after that statement closed -- and any charge that was
//                   due by the first statement but hadn't posted yet.
//
// So each dollar on the card is paid exactly once. Charges are the card's
// own Expense schedules at their expected amounts; everyday card spending
// isn't scheduled anywhere and is covered by the cushion, the same as
// everyday debit spending.
function cardPaymentCents(
  s: ProjectionSchedule,
  occurrences: Occurrence[],
  cardCharges: { due: string; cents: number }[],
): number[] {
  const card = s.cardPayment!;
  const statementDay = s.statementDay!;
  const statements = occurrences.map((o) => statementDateForCycle(o.cursor, statementDay));
  const chargesThrough = (from: string | null, to: string) =>
    cardCharges
      .filter((c) => (from === null || c.due > from) && c.due <= to)
      .reduce((sum, c) => sum + c.cents, 0);

  const owedCents = toCents(card.balanceOwed);
  const nextCents = toCents(s.amount);
  const beforeFirstStatement = statements.length > 0 ? chargesThrough(null, statements[0]) : 0;

  return statements.map((statement, k) => {
    if (k === 0) {
      return card.amountConfirmed ? nextCents : owedCents + beforeFirstStatement;
    }
    const cycle = chargesThrough(statements[k - 1], statement);
    if (k === 1 && card.amountConfirmed) {
      return Math.max(0, owedCents - nextCents) + beforeFirstStatement + cycle;
    }
    return cycle;
  });
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
        dueDate: due,
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
    const occurrences = expandOccurrences(s, obligationSearchEnd, holidays);
    const amountsCents =
      s.cardPayment && s.statementDay !== null
        ? cardPaymentCents(
            s,
            occurrences,
            schedules
              .filter((c) => c.kind === "Expense" && c.accountId === s.toAccountId)
              .flatMap((c) =>
                expandDueDates(c, obligationSearchEnd, holidays).map((due) => ({ due, cents: toCents(c.amount) })),
              ),
          )
        : occurrences.map(() => toCents(s.amount));

    occurrences.forEach(({ due }, k) => {
      if (due < today && !overdueObligations.some((o) => o.recurringId === s.recurringId)) {
        overdueObligations.push(overdue(s, due));
      }
      const early = expenseCommitmentDate(due, s.dateToleranceDays);
      const date = early < today ? today : early;
      if (date > horizonEnd) return;
      obligations.push({
        recurringId: s.recurringId,
        name: s.name,
        amount: toDollars(amountsCents[k]),
        date,
        dueDate: due,
        // Past the next payment, a card payment is always built from estimates.
        isEstimate: s.isEstimate || (s.cardPayment !== null && k > 0),
      });
    });
  }
  obligations.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Day-by-day walk. Outflows before inflows within a day; the earliest
  // day wins a tie for the trough.
  const outByDay = new Map<string, ProjectedObligation[]>();
  for (const o of obligations) {
    outByDay.set(o.date, [...(outByDay.get(o.date) ?? []), o]);
  }
  const inByDay = new Map<string, ProjectedIncome[]>();
  for (const i of incomes) {
    inByDay.set(i.date, [...(inByDay.get(i.date) ?? []), i]);
  }

  const cashCents = toCents(input.cash);
  let balance = cashCents;
  let troughCents = cashCents;
  let troughDate = today;
  let troughObligations: ProjectedObligation[] = [];
  const days: WalkedDay[] = [];

  for (let day = today; day <= horizonEnd; day = addDaysISO(day, 1)) {
    const out = outByDay.get(day) ?? [];
    if (out.length > 0) {
      balance -= out.reduce((sum, o) => sum + toCents(o.amount), 0);
      if (balance < troughCents) {
        troughCents = balance;
        troughDate = day;
        troughObligations = out;
      }
    }
    const lowCents = balance;
    const income = inByDay.get(day) ?? [];
    balance += income.reduce((sum, i) => sum + toCents(i.amount), 0);
    days.push({ date: day, lowCents, endCents: balance, out, income });
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
    episodes: findSqueezeEpisodes(days, cushionCents, troughDate),
    daily: days.map((d) => ({ date: d.date, low: toDollars(d.lowCents), end: toDollars(d.endCents) })),
  };
}

type WalkedDay = {
  date: string;
  /** After the day's obligations, before its income. */
  lowCents: number;
  /** After its income -- what the next day opens on. */
  endCents: number;
  out: ProjectedObligation[];
  income: ProjectedIncome[];
};

// Group the walk's days into runs below the cushion. A day exactly at the
// cushion is clear; a day exactly at zero is tight, not short.
//
// Money only comes back in as income, so a run ends on the day income
// lifts the balance back to the cushion -- that day is still in the run
// (its low comes before the paycheck), and that income is the recovery.
// When the final day's income does that, the run has a recovery inside
// the horizon and isn't open-ended.
function findSqueezeEpisodes(days: WalkedDay[], cushionCents: number, troughDate: string): SqueezeEpisode[] {
  const episodes: SqueezeEpisode[] = [];
  let run: WalkedDay[] = [];

  const close = (recovered: boolean) => {
    const first = run[0];
    const last = run[run.length - 1];
    const low = run.reduce((min, d) => (d.lowCents < min.lowCents ? d : min));
    episodes.push({
      startDate: first.date,
      endDate: last.date,
      severity: run.some((d) => d.lowCents < 0) ? "shortfall" : "tight",
      lowPoint: { amount: toDollars(low.lowCents), date: low.date },
      drivers: run
        .flatMap((d) => d.out)
        .sort((a, b) => b.amount - a.amount || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
      recovery: recovered
        ? { date: last.date, description: last.income.map((i) => i.name).join(" and ") }
        : null,
      openEnded: !recovered,
      containsTrough: first.date <= troughDate && troughDate <= last.date,
    });
    run = [];
  };

  for (const d of days) {
    if (d.lowCents >= cushionCents) continue;
    run.push(d);
    if (d.endCents >= cushionCents) close(true);
  }
  if (run.length > 0) close(false);

  return episodes;
}
