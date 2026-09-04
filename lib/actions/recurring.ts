"use server";

import { revalidatePath } from "next/cache";
import {
  createRecurring,
  updateRecurring,
  deleteRecurring,
  pauseRecurring,
  resumeRecurring,
} from "@/lib/db/recurring";

export type ActionState = { error?: string } | undefined;

// What the schedule picker actually offers -- a subset of what
// rectx_frequency_check still allows (Daily/Biweekly/Quarterly stay valid
// for any pre-existing row; the picker just stops writing them). "every N
// weeks" is Weekly + interval_count, not a frequency value of its own.
const FREQUENCIES = ["Monthly", "Weekly", "Yearly"] as const;
const ENDS_MODES = ["never", "count", "date"] as const;

type ParsedRecurringFields = {
  description: string;
  amount: number;
  categoryid: string;
  accountid: string;
  frequency: string;
  interval_count: number;
  next_run_date: string;
  occurrence_limit: number | null;
  end_date: string | null;
};

// Shared by create and update -- both forms offer the exact same fields.
function parseRecurringFields(formData: FormData): ParsedRecurringFields | { error: string } {
  const description = String(formData.get("description") ?? "").trim();
  const amountInput = String(formData.get("amount") ?? "").trim();
  const categoryid = String(formData.get("categoryid") ?? "");
  const accountid = String(formData.get("accountid") ?? "");
  const frequency = String(formData.get("frequency") ?? "");
  const next_run_date = String(formData.get("next_run_date") ?? "");
  const ends = String(formData.get("ends") ?? "never");

  if (!description) {
    return { error: "Enter a description." };
  }

  const amount = Number(amountInput);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter an amount greater than zero." };
  }
  if (!categoryid) {
    return { error: "Choose a category." };
  }
  if (!accountid) {
    return { error: "Choose an account." };
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

  return {
    description,
    amount,
    categoryid,
    accountid,
    frequency,
    interval_count,
    next_run_date,
    occurrence_limit,
    end_date,
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
    frequency: parsed.frequency,
    interval_count: parsed.interval_count,
    next_run_date: parsed.next_run_date,
    // Informational record of when the schedule began -- next_run_date is
    // the only field the generator actually advances (see lib/db/recurring.ts).
    start_date: parsed.next_run_date,
    occurrence_limit: parsed.occurrence_limit,
    end_date: parsed.end_date,
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

  const { error } = await updateRecurring(id, {
    description: parsed.description,
    amount: parsed.amount,
    categoryid: parsed.categoryid,
    accountid: parsed.accountid,
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
  });

  if (error) {
    return { error };
  }

  revalidatePath("/recurring");
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
