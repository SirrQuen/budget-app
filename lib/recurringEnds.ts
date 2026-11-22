// When a schedule ends -- the one rule, in TypeScript.
//
// An occurrence belongs to a schedule when its SCHEDULED date (the raw
// cursor, next_run_date and the cursors stepped from it) is on or before
// end_date, and it is within the occurrences left of occurrence_limit.
// The business-day adjustment only moves when it posts; it never decides
// inclusion. Never compared to today: an occurrence on or before the end
// date stays until it's answered (ruled 2026-11-22).
//
// SQL twin: recurring_is_finished() / recurring_occurrences_remaining()
// (migration 79), which v_upcoming_recurring filters on and
// v_recurring_state exposes. `npm run test:parity:ends` runs
// docs/recurring-ends-test.sql and checks these agree with it on every
// row. Never compare an end date or an occurrence count anywhere else.

/** What a schedule's end condition leaves of it, read from v_upcoming_recurring / v_recurring_state. */
export type ScheduleEnd = {
  /** end_date, inclusive, compared with SCHEDULED dates. Null: no end date. */
  endDate: string | null;
  /** occurrence_limit minus occurrences done, never below 0. Null: no limit. */
  occurrencesRemaining: number | null;
};

/** occurrence_limit minus the occurrences done, never below 0; null without a limit. */
export function remainingOccurrences(occurrenceLimit: number | null, occurrencesDone: number): number | null {
  return occurrenceLimit === null ? null : Math.max(occurrenceLimit - occurrencesDone, 0);
}

/**
 * Whether the occurrence scheduled on `cursor` -- the k-th from the
 * schedule's pending one, counting from 0 -- belongs to the schedule.
 */
export function isScheduledOccurrence(end: ScheduleEnd, cursor: string, k: number): boolean {
  if (end.occurrencesRemaining !== null && k >= end.occurrencesRemaining) return false;
  if (end.endDate !== null && cursor > end.endDate) return false;
  return true;
}

/**
 * The form's "The end date can't be before the next date." -- asked only
 * when the end date or the next date is being set: on create, or when an
 * edit changes either. An ended schedule's next date is already past its
 * end date, and renaming it must still save (ruled 2026-11-22).
 */
export function endDateOrderError(
  edited: { next_run_date: string; end_date: string | null },
  stored: { next_run_date: string; end_date: string | null } | null,
): string | null {
  if (edited.end_date === null || edited.end_date >= edited.next_run_date) return null;
  if (
    stored !== null &&
    stored.end_date === edited.end_date &&
    stored.next_run_date === edited.next_run_date
  ) {
    return null;
  }
  return "The end date can't be before the next date.";
}

/** Finished: the pending occurrence doesn't belong. Derived, never stored. */
export function isFinished(end: ScheduleEnd, nextRunDate: string): boolean {
  return !isScheduledOccurrence(end, nextRunDate, 0);
}
