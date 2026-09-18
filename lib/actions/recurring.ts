"use server";

import { revalidatePath } from "next/cache";
import {
  createRecurring,
  updateRecurring,
  deleteRecurring,
  pauseRecurring,
  resumeRecurring,
  getRecurring,
  confirmVariableAmount,
  confirmIncomeOccurrence,
} from "@/lib/db/recurring";

export type ActionState = { error?: string } | undefined;

// What the schedule picker actually offers -- a subset of what
// rectx_frequency_check still allows (Daily/Biweekly/Quarterly stay valid
// for any pre-existing row; the picker just stops writing them). "every N
// weeks" is Weekly + interval_count, not a frequency value of its own.
const FREQUENCIES = ["Monthly", "Weekly", "Yearly"] as const;
const ENDS_MODES = ["never", "count", "date"] as const;
const KINDS = ["Expense", "Income", "Transfer"] as const;

// RecurringForm's plain-language timing control -- see its own
// TIMING_MODE_OPTIONS/NEAREST_DIRECTION_OPTIONS. Absent entirely when the
// "Adjust timing" panel is collapsed (the fields it holds aren't rendered,
// so they aren't submitted); "exact" here means exactly that, same as an
// explicit choice of it.
const TIMING_MODES = ["exact", "nearest", "after"] as const;
const NEAREST_DIRECTIONS = ["earlier", "later"] as const;

type ParsedRecurringFields = {
  description: string;
  amount: number;
  categoryid: string | null;
  accountid: string;
  to_accountid: string | null;
  frequency: string;
  interval_count: number;
  next_run_date: string;
  occurrence_limit: number | null;
  end_date: string | null;
  // Variable amount -- a transfer (credit card payment,
  // 20260912000023_23_recurring_variable_amount.sql) or an Income category
  // schedule (29_recurring_income_confirmation.sql), never a bare Expense.
  // statement_day is required exactly when amount_is_variable is set
  // alongside a transfer (rectx_variable_requires_statement_day) -- an
  // Income schedule never has one.
  amount_is_variable: boolean;
  statement_day: number | null;
  // "Date varies" -- Income only, independent of amount_is_variable (a
  // paycheck can have a fixed date but variable hours, or the reverse). 0
  // when not set: identical in effect to "doesn't vary" (see
  // rectx_date_tolerance_range / lib/recurringSchedule.ts), never null.
  date_tolerance_days: number;
  // True for every Income schedule, forced here rather than read from the
  // form -- CLAUDE.md "Auto-create outflows. Confirm inflows." is not a
  // user preference.
  requires_confirmation: boolean;
  // Business-day resolution (20260914000024_24_recurring_business_day_rules.sql)
  // -- derived from RecurringForm's timing_mode/timing_direction/timing_count
  // below, never read directly from those raw field names past this function.
  business_day_offset: number;
  non_business_day_rule: string;
};

// Shared by create and update -- both forms offer the exact same fields.
function parseRecurringFields(formData: FormData): ParsedRecurringFields | { error: string } {
  const description = String(formData.get("description") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  const frequency = String(formData.get("frequency") ?? "");
  const next_run_date = String(formData.get("next_run_date") ?? "");
  const ends = String(formData.get("ends") ?? "never");

  if (!description) {
    return { error: "Enter a description." };
  }

  if (!KINDS.includes(kind as (typeof KINDS)[number])) {
    return { error: "Choose a type." };
  }

  let categoryid: string | null = null;
  let accountid: string;
  let to_accountid: string | null = null;
  let amount_is_variable = false;
  let statement_day: number | null = null;
  let date_tolerance_days = 0;

  if (kind === "Transfer") {
    // "accountid" doubles as the transfer's source ("from") account --
    // same field name RecurringForm's From/To pair and category mode's
    // single Account picker both submit, since a category schedule and a
    // transfer's source account are the same concept either way (see the
    // 19_recurring_transfers migration).
    accountid = String(formData.get("accountid") ?? "");
    to_accountid = String(formData.get("to_accountid") ?? "");
    if (!accountid) {
      return { error: "Choose a from account." };
    }
    if (!to_accountid) {
      return { error: "Choose a to account." };
    }
    if (accountid === to_accountid) {
      return { error: "Choose two different accounts for a transfer." };
    }

    // The checkbox only ever renders (and so only ever submits "on") when
    // RecurringForm has a Credit Card destination selected -- see
    // RecurringForm.tsx. Trusting formData here rather than re-checking the
    // destination's account_type is fine: worst case a client bypass sets
    // amount_is_variable on a non-card transfer, which is still a
    // perfectly valid variable-amount transfer as far as the schema cares.
    amount_is_variable = formData.get("amount_is_variable") === "on";
    if (amount_is_variable) {
      const statementDayInput = String(formData.get("statement_day") ?? "").trim();
      statement_day = Math.trunc(Number(statementDayInput));
      if (!Number.isFinite(statement_day) || statement_day < 1 || statement_day > 31) {
        return { error: "Enter a statement day between 1 and 31." };
      }
    }
  } else {
    categoryid = String(formData.get("categoryid") ?? "");
    accountid = String(formData.get("accountid") ?? "");
    if (!categoryid) {
      return { error: "Choose a category." };
    }
    if (!accountid) {
      return { error: "Choose an account." };
    }

    // "Amount changes each time" / "Date varies" -- Income only (the
    // checkboxes only render there, same trust-the-client reasoning as the
    // Transfer branch's own amount_is_variable read above; enforce_recurring_
    // variability_scope rejects either one on a non-Income category
    // regardless). Independent of each other -- a paycheck can vary in
    // amount, in date, in both, or in neither.
    if (kind === "Income") {
      amount_is_variable = formData.get("amount_is_variable") === "on";
      const dateVaries = formData.get("date_varies") === "on";
      if (dateVaries) {
        const toleranceInput = String(formData.get("date_tolerance_days") ?? "").trim();
        date_tolerance_days = Math.trunc(Number(toleranceInput));
        if (!Number.isFinite(date_tolerance_days) || date_tolerance_days < 0 || date_tolerance_days > 14) {
          return { error: "Enter a tolerance between 0 and 14 days." };
        }
      }
    }
  }

  // A card payment's real amount only ever comes from a confirmed
  // next_amount or a live card-balance estimate (see
  // estimateCardPaymentDue/v_upcoming_recurring) -- amount stays 0, an
  // unused placeholder the NOT NULL column still needs. An Income schedule
  // always keeps its amount input, even while amount_is_variable: it's the
  // fallback estimate (estimate_income_amount) until three confirmed
  // occurrences exist, never an unused placeholder the way a card's is.
  const amountInputHidden = kind === "Transfer" && amount_is_variable;
  let amount = 0;
  if (!amountInputHidden) {
    const amountInput = String(formData.get("amount") ?? "").trim();
    amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: "Enter an amount greater than zero." };
    }
  }

  if (!FREQUENCIES.includes(frequency as (typeof FREQUENCIES)[number])) {
    return { error: "Choose how often this repeats." };
  }
  if (!next_run_date) {
    return { error: "Choose the next due date." };
  }

  // Only Weekly asks for it -- Monthly/Yearly always step by one month/year,
  // so this stays 1 (the column default) and unused for them.
  let interval_count = 1;
  if (frequency === "Weekly") {
    const intervalInput = String(formData.get("interval_count") ?? "").trim();
    interval_count = Math.trunc(Number(intervalInput));
    if (!Number.isFinite(interval_count) || interval_count < 1 || interval_count > 52) {
      return { error: "Enter how many weeks apart, from 1 to 52." };
    }
  }

  if (!ENDS_MODES.includes(ends as (typeof ENDS_MODES)[number])) {
    return { error: "Choose when this ends." };
  }

  let occurrence_limit: number | null = null;
  let end_date: string | null = null;

  if (ends === "count") {
    const countInput = String(formData.get("occurrence_count") ?? "").trim();
    occurrence_limit = Math.trunc(Number(countInput));
    if (!Number.isFinite(occurrence_limit) || occurrence_limit < 1) {
      return { error: "Enter how many occurrences before this ends." };
    }
  } else if (ends === "date") {
    end_date = String(formData.get("end_date") ?? "").trim() || null;
    if (!end_date) {
      return { error: "Choose an end date." };
    }
    if (end_date < next_run_date) {
      return { error: "The end date can't be before the next due date." };
    }
  }

  // "exact" (the collapsed-panel default) maps to offset 0 / rule 'none' --
  // identical to what every row already meant before this control existed.
  const timingMode = String(formData.get("timing_mode") ?? "exact");
  if (!TIMING_MODES.includes(timingMode as (typeof TIMING_MODES)[number])) {
    return { error: "Choose a valid timing option." };
  }

  let business_day_offset = 0;
  let non_business_day_rule = "none";

  if (timingMode === "after") {
    const countInput = String(formData.get("timing_count") ?? "").trim();
    business_day_offset = Math.trunc(Number(countInput));
    if (!Number.isFinite(business_day_offset) || business_day_offset < 1 || business_day_offset > 10) {
      return { error: "Enter how many business days, from 1 to 10." };
    }
  } else if (timingMode === "nearest") {
    const direction = String(formData.get("timing_direction") ?? "earlier");
    if (!NEAREST_DIRECTIONS.includes(direction as (typeof NEAREST_DIRECTIONS)[number])) {
      return { error: "Choose a valid shift direction." };
    }
    non_business_day_rule = direction === "earlier" ? "before" : "after";
  }

  return {
    description,
    amount,
    categoryid,
    accountid,
    to_accountid,
    frequency,
    interval_count,
    next_run_date,
    occurrence_limit,
    end_date,
    amount_is_variable,
    statement_day,
    date_tolerance_days,
    requires_confirmation: kind === "Income",
    business_day_offset,
    non_business_day_rule,
  };
}

export async function createRecurringAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseRecurringFields(formData);
  if ("error" in parsed) {
    return parsed;
  }

  const { error } = await createRecurring({
    description: parsed.description,
    amount: parsed.amount,
    categoryid: parsed.categoryid,
    accountid: parsed.accountid,
    to_accountid: parsed.to_accountid,
    frequency: parsed.frequency,
    interval_count: parsed.interval_count,
    next_run_date: parsed.next_run_date,
    // Informational record of when the schedule began -- next_run_date is
    // the only field the generator actually advances (see lib/db/recurring.ts).
    start_date: parsed.next_run_date,
    occurrence_limit: parsed.occurrence_limit,
    end_date: parsed.end_date,
    amount_is_variable: parsed.amount_is_variable,
    statement_day: parsed.statement_day,
    date_tolerance_days: parsed.date_tolerance_days,
    requires_confirmation: parsed.requires_confirmation,
    business_day_offset: parsed.business_day_offset,
    non_business_day_rule: parsed.non_business_day_rule,
  });

  if (error) {
    return { error };
  }

  revalidatePath("/recurring");
}

export async function updateRecurringAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) {
    return { error: "Missing schedule id." };
  }

  const parsed = parseRecurringFields(formData);
  if ("error" in parsed) {
    return parsed;
  }

  // A pending confirmation (next_amount/next_amount_confirmed_at) belongs to
  // a specific cycle of a specific card. Turning "Amount changes each month"
  // off must clear it -- rectx_next_amount_requires_variable would otherwise
  // reject the update outright. Switching the destination account while
  // staying variable must clear it too: a confirmed amount is the OLD
  // card's balance, and carrying it over to a different card would post the
  // wrong figure next cycle. Neither touches next_amount/confirmed_at.
  let clearPendingConfirmation = !parsed.amount_is_variable;
  if (parsed.amount_is_variable && !clearPendingConfirmation) {
    const current = await getRecurring(id);
    if (current.data && current.data.to_accountid !== parsed.to_accountid) {
      clearPendingConfirmation = true;
    }
  }

  const { error } = await updateRecurring(id, {
    description: parsed.description,
    amount: parsed.amount,
    categoryid: parsed.categoryid,
    accountid: parsed.accountid,
    to_accountid: parsed.to_accountid,
    frequency: parsed.frequency,
    interval_count: parsed.interval_count,
    next_run_date: parsed.next_run_date,
    // Re-anchors the cadence to the edited date -- start_date is what
    // nextOccurrenceISO reads as the fixed day-of-month/month-day (see
    // lib/db/recurring.ts), and the generator never advances it itself.
    // Choosing a new "Next due date" here is a deliberate re-pin (e.g. a
    // rent schedule moving from the 1st to the 5th), not a catch-up step,
    // so it's exactly the case that should move the anchor too.
    start_date: parsed.next_run_date,
    // Explicit even when null -- switching "Ends" back to Never (or from a
    // date to a count) must clear whichever of the two isn't in play
    // anymore, not just leave the old value stuck from before the edit.
    occurrence_limit: parsed.occurrence_limit,
    end_date: parsed.end_date,
    amount_is_variable: parsed.amount_is_variable,
    statement_day: parsed.statement_day,
    date_tolerance_days: parsed.date_tolerance_days,
    requires_confirmation: parsed.requires_confirmation,
    business_day_offset: parsed.business_day_offset,
    non_business_day_rule: parsed.non_business_day_rule,
    ...(clearPendingConfirmation ? { next_amount: null, next_amount_confirmed_at: null } : {}),
  });

  if (error) {
    return { error };
  }

  revalidatePath("/recurring");
  revalidatePath("/dashboard");
}

export async function deleteRecurringAction(id: string): Promise<ActionState> {
  if (!id) {
    return { error: "Missing schedule id." };
  }

  const { error } = await deleteRecurring(id);
  if (error) {
    return { error };
  }

  revalidatePath("/recurring");
}

export async function pauseRecurringAction(id: string): Promise<ActionState> {
  if (!id) {
    return { error: "Missing schedule id." };
  }

  const { error } = await pauseRecurring(id);
  if (error) {
    return { error };
  }

  revalidatePath("/recurring");
}

export async function resumeRecurringAction(id: string): Promise<ActionState> {
  if (!id) {
    return { error: "Missing schedule id." };
  }

  const { error } = await resumeRecurring(id);
  if (error) {
    return { error };
  }

  revalidatePath("/recurring");
}

// Confirming is reachable from the upcoming commitments list, the recurring
// list row, and the dashboard prompt (see ConfirmVariableAmountSheet) --
// all three submit the same single-field form.
export async function confirmVariableAmountAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) {
    return { error: "Missing schedule id." };
  }

  const amountInput = String(formData.get("amount") ?? "").trim();
  const amount = Number(amountInput);
  if (!Number.isFinite(amount) || amount < 0) {
    return { error: "Enter an amount of zero or more." };
  }

  const { error } = await confirmVariableAmount(id, amount);
  if (error) {
    return { error };
  }

  revalidatePath("/recurring");
  revalidatePath("/dashboard");
}

// Confirming an Income schedule writes the transaction immediately (see
// confirmIncomeOccurrence) rather than staging a pending amount -- reachable
// from the same three places as confirmVariableAmountAction: the upcoming
// list, the recurring row, and the dashboard prompt (see ConfirmIncomeSheet).
export async function confirmIncomeAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  if (!id) {
    return { error: "Missing schedule id." };
  }

  const amountInput = String(formData.get("amount") ?? "").trim();
  const amount = Number(amountInput);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter an amount greater than zero." };
  }

  const { error } = await confirmIncomeOccurrence(id, amount);
  if (error) {
    return { error };
  }

  revalidatePath("/recurring");
  revalidatePath("/dashboard");
}
