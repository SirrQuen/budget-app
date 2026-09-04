import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { describeReadError, describeWriteError } from "@/lib/db/errors";
import { todayISO, addDaysISO } from "@/lib/date";

type RecurringRow = Database["public"]["Tables"]["recurring_transactions"]["Row"];
type RecurringInsert = Database["public"]["Tables"]["recurring_transactions"]["Insert"];
type RecurringUpdate = Database["public"]["Tables"]["recurring_transactions"]["Update"];
type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"];
type UpcomingRecurringRow = Database["public"]["Views"]["v_upcoming_recurring"]["Row"];

export type DbResult<T> = { data: T; error: null } | { data: null; error: string };

export type RecurringWithRelations = RecurringRow & {
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
  // Needed by the edit form to pre-select Income/Expense -- see CLAUDE.md
  // "Recurring transactions": the schedule carries no transaction_type of
  // its own, direction always comes from the linked category.
  category_type: string | null;
  account_name: string | null;
};

// categoryid/accountid have FK relationships to several relations (base
// tables, plus reporting views) -- naming "categories"/"accounts" explicitly
// picks the base-table relationship, same as transactions.ts's TRANSACTION_SELECT.
const RECURRING_SELECT =
  "*, category:categories(category_name, color, icon, category_type), account:accounts(account_name)";

type RawRecurringRow = RecurringRow & {
  category: { category_name: string; color: string | null; icon: string | null; category_type: string } | null;
  account: { account_name: string } | null;
};

function flatten(row: RawRecurringRow): RecurringWithRelations {
  const { category, account, ...rest } = row;
  return {
    ...rest,
    category_name: category?.category_name ?? null,
    category_color: category?.color ?? null,
    category_icon: category?.icon ?? null,
    category_type: category?.category_type ?? null,
    account_name: account?.account_name ?? null,
  };
}

// ---------------------------------------------------------------------------
// Cadence math
//
// frequency is validated by rectx_frequency_check --
// Daily/Weekly/Biweekly/Monthly/Quarterly/Yearly (see CLAUDE.md "Recurring
// transactions"). Day-of-month/weekday isn't stored anywhere: the schedule is
// entirely "one cadence step from next_run_date", so this is the one place
// that owns the calendar edge cases. Both generateDueOccurrences and any
// future "preview the next occurrence" UI should go through this rather than
// re-deriving it.
// ---------------------------------------------------------------------------

// Adds whole months to an ISO date, landing on anchorDay -- clamped to the
// target month's last day when anchorDay doesn't exist there (anchorDay 31,
// target month Feb -> the 28th/29th, not rolled into March).
//
// anchorDay is deliberately NOT derived from dateISO's own day. Doing that
// would drift the schedule permanently downward the first time a short
// month clamps it: Jan 31 -> Feb 28 (correct), then Feb 28 + 1 month -> Mar
// 28 forever, never back to the 31st a 31-day month actually has. Passing a
// fixed anchorDay (the caller reads it from start_date, which the generator
// never advances) means a July 31 occurrence, three months after a Feb
// clamp, is still the 31st -- and the same guards a Yearly Feb 29 schedule
// from getting stuck on the 28th once it crosses a non-leap year.
function addMonthsClampedISO(dateISO: string, months: number, anchorDay: number): string {
  const [year, month] = dateISO.split("-").map(Number);
  const total = month - 1 + months;
  const targetYear = year + Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const d = new Date(targetYear, targetMonth, Math.min(anchorDay, lastDayOfTargetMonth));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dayOfMonth(dateISO: string): number {
  return Number(dateISO.split("-")[2]);
}

// intervalCount is the N in "every N weeks" -- meaningful for Weekly only.
// anchorDateISO is the schedule's stable reference point for Monthly/
// Quarterly/Yearly (see addMonthsClampedISO) -- callers pass
// template.start_date, never the cursor being advanced. Weekly/Biweekly
// don't need it: +7*N days never drifts off the original weekday the way
// month-length clamping drifts off a day-of-month, so cursor arithmetic
// alone is exact.
//
// Not exported: this file is server-only, and lib/recurringSchedule.ts (the
// client-safe copy of this same cadence, for the schedule picker and each
// row's display text) has to duplicate the switch rather than import it --
// keep the two in sync by hand if a case here ever changes.
//
// Daily/Biweekly/Quarterly are still handled here for any row already
// carrying one of those values -- rectx_frequency_check still allows them --
// but the schedule picker no longer writes them: "every N weeks" (Weekly +
// interval_count) folds Biweekly's job in, and Daily/Quarterly turned out to
// be exotic enough nobody used them.
function nextOccurrenceISO(
  dateISO: string,
  frequency: string,
  intervalCount: number,
  anchorDateISO: string,
): string {
  switch (frequency) {
    case "Daily":
      return addDaysISO(dateISO, 1);
    case "Weekly":
      return addDaysISO(dateISO, 7 * intervalCount);
    case "Biweekly":
      return addDaysISO(dateISO, 14);
    case "Monthly":
      return addMonthsClampedISO(dateISO, 1, dayOfMonth(anchorDateISO));
    case "Quarterly":
      return addMonthsClampedISO(dateISO, 3, dayOfMonth(anchorDateISO));
    case "Yearly":
      return addMonthsClampedISO(dateISO, 12, dayOfMonth(anchorDateISO));
    default:
      // rectx_frequency_check should make this unreachable -- fail loudly
      // rather than silently stalling a schedule on a value the DB let through.
      throw new Error(`Unknown recurring frequency: ${frequency}`);
  }
}

export type ListRecurringOptions = {
  /** true = active only, false = paused only. Omit for both. */
  isActive?: boolean;
};

export async function listRecurring(
  opts: ListRecurringOptions = {},
): Promise<DbResult<RecurringWithRelations[]>> {
  const supabase = await createClient();

  let query = supabase
    .from("recurring_transactions")
    .select(RECURRING_SELECT)
    .order("next_run_date", { ascending: true });

  if (opts.isActive !== undefined) {
    query = query.eq("is_active", opts.isActive);
  }

  const { data, error } = await query.returns<RawRecurringRow[]>();

  if (error) {
    return { data: null, error: describeReadError(error, "recurring transactions") };
  }

  return { data: data.map(flatten), error: null };
}

export async function getRecurring(id: string): Promise<DbResult<RecurringWithRelations>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("recurring_transactions")
    .select(RECURRING_SELECT)
    .eq("id", id)
    .single()
    .returns<RawRecurringRow>();

  if (error) {
    return { data: null, error: describeReadError(error, "recurring transaction") };
  }

  return { data: flatten(data), error: null };
}

export type CreateRecurringInput = Omit<
  RecurringInsert,
  "userid" | "id" | "created_at" | "is_active"
>;

export async function createRecurring(
  input: CreateRecurringInput,
): Promise<DbResult<RecurringRow>> {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userid = claimsData?.claims?.sub;

  if (claimsError || !userid) {
    return {
      data: null,
      error: "Your session's expired. Log in again to pick up where you left off.",
    };
  }

  const { data, error } = await supabase
    .from("recurring_transactions")
    .insert({ ...input, userid })
    .select()
    .single();

  if (error) {
    return { data: null, error: describeWriteError(error, "recurring") };
  }

  return { data, error: null };
}

export type UpdateRecurringPatch = Omit<RecurringUpdate, "id" | "userid" | "created_at">;

export async function updateRecurring(
  id: string,
  patch: UpdateRecurringPatch,
): Promise<DbResult<RecurringRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("recurring_transactions")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return { data: null, error: describeWriteError(error, "recurring") };
  }

  return { data, error: null };
}

// transactions.recurringid is ON DELETE SET NULL
// (transactions_recurringid_fkey, 04_hardening.sql) -- deleting a schedule
// detaches the transactions it already produced instead of deleting them;
// that history is real. Nothing else touches this FK: no migration after
// 04_hardening.sql redefines it, no CASCADE, no trigger, no pre-delete
// cleanup here. A plain delete on the template row is exactly the right
// operation -- confirmed against the migrations, not assumed.
export async function deleteRecurring(id: string): Promise<DbResult<{ id: string }>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("recurring_transactions")
    .delete()
    .eq("id", id)
    .select("id")
    .single();

  if (error) {
    return { data: null, error: describeWriteError(error, "recurring") };
  }

  return { data, error: null };
}

// Pausing (not deleting) is the right move for something that will likely
// come back -- a subscription on hold, a bill you're disputing. is_active
// also gates v_upcoming_recurring and generateDueOccurrences, so a paused
// template quietly stops appearing as a commitment and stops generating
// transactions without losing its settings.
export async function pauseRecurring(id: string): Promise<DbResult<RecurringRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("recurring_transactions")
    .update({ is_active: false })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return { data: null, error: describeWriteError(error, "recurring") };
  }

  return { data, error: null };
}

// Resuming skips whatever the schedule missed while paused, rather than
// leaving next_run_date wherever it was. Without this, a subscription paused
// for a few months would dump a backlog of backdated transactions into the
// account the next time occurrences are generated -- the opposite of what
// pausing was for. next_run_date only ever moves forward here: a template
// that's still due today or ahead of schedule is untouched.
export async function resumeRecurring(id: string): Promise<DbResult<RecurringRow>> {
  const supabase = await createClient();
  const today = todayISO();

  const { data: current, error: readError } = await supabase
    .from("recurring_transactions")
    .select("next_run_date")
    .eq("id", id)
    .single();

  if (readError) {
    return { data: null, error: describeWriteError(readError, "recurring") };
  }

  const patch: RecurringUpdate = { is_active: true };
  if (current.next_run_date < today) {
    patch.next_run_date = today;
  }

  const { data, error } = await supabase
    .from("recurring_transactions")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return { data: null, error: describeWriteError(error, "recurring") };
  }

  return { data, error: null };
}

/** A transaction row that was posted from a schedule, for the "we added N transactions while you were away" summary. */
export type GeneratedOccurrence = TransactionRow;

type DueRecurringRow = {
  id: string;
  description: string;
  amount: number;
  accountid: string;
  categoryid: string;
  next_run_date: string;
  // The schedule's stable anchor for Monthly/Quarterly/Yearly's day-of-month
  // -- see nextOccurrenceISO. Nullable in the schema; falls back to
  // next_run_date below for a row somehow missing it rather than crashing
  // catch-up for every other schedule in the same batch.
  start_date: string | null;
  end_date: string | null;
  frequency: string;
  interval_count: number;
  occurrence_limit: number | null;
  category: { category_type: string };
};

// Lazy catch-up, run when a user opens the app -- there is no scheduler.
// recurring_transactions carries no transaction_type of its own; direction
// comes from the linked category's category_type, same rule createTransaction
// enforces via the enforce_category_type trigger.
//
// Idempotency is a database guarantee, not an application one:
// recurring_tx_no_double_post is a unique index on
// (recurringid, transaction_date) where recurringid is not null
// (04_hardening.sql). Two concurrent page loads racing to generate the same
// occurrence both attempt the insert; exactly one succeeds, and the loser's
// 23505 is treated as success -- the occurrence exists, which is the only
// thing that was ever being asked for. A non-23505 failure stops that
// template's loop without advancing next_run_date, so the missed occurrence
// is retried on the next catch-up rather than silently skipped, but doesn't
// block generation for the user's other schedules.
//
// cache()d like recordLogin/getLoggingStreak: app/(app)/layout.tsx runs this
// on every authenticated route so a schedule can't go stale just because a
// user always lands on /transactions, and DashboardPage asks again for the
// created list to build its "while you were away" banner. Both calls
// resolve to the one run this request actually did, in whichever of the two
// happens to reach it first -- never two independent generation passes
// racing each other in the same request.
export const generateDueOccurrences = cache(async (): Promise<
  DbResult<GeneratedOccurrence[]>
> => {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userid = claimsData?.claims?.sub;

  if (claimsError || !userid) {
    return {
      data: null,
      error: "Your session's expired. Log in again to pick up where you left off.",
    };
  }

  const today = todayISO();

  // RLS scopes this to the caller's own rows already -- no manual userid
  // filter needed (see CLAUDE.md "Data layer rules").
  const { data: due, error: dueError } = await supabase
    .from("recurring_transactions")
    .select(
      "id, description, amount, accountid, categoryid, next_run_date, start_date, end_date, frequency, interval_count, occurrence_limit, category:categories!inner(category_type)",
    )
    .eq("is_active", true)
    .lte("next_run_date", today)
    .returns<DueRecurringRow[]>();

  if (dueError) {
    return { data: null, error: describeReadError(dueError, "recurring transactions") };
  }

  const created: GeneratedOccurrence[] = [];

  for (const template of due) {
    let cursor = template.next_run_date;
    let advanced = false;
    const anchor = template.start_date ?? template.next_run_date;

    // "Ends after N occurrences" is tracked by counting the ledger, never a
    // stored counter (see the 18_recurring_schedule migration) -- so a
    // capped template gets one extra read here, up front, rather than a
    // query per occurrence. Uncapped templates (the common case) skip it.
    let remaining = Infinity;
    if (template.occurrence_limit !== null) {
      const { count, error: countError } = await supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("recurringid", template.id);

      if (countError) {
        console.error(
          `[db:recurring] failed counting occurrences for ${template.id}:`,
          countError,
        );
        continue;
      }

      remaining = template.occurrence_limit - (count ?? 0);
    }

    while (cursor <= today && remaining > 0) {
      // Mirrors v_upcoming_recurring's own end-date guard: a template that
      // has already ended isn't due again even if next_run_date wasn't
      // advanced past it. Leave next_run_date as-is -- there's nothing left
      // to catch up.
      if (template.end_date && cursor > template.end_date) break;

      const { data: row, error: insertError } = await supabase
        .from("transactions")
        .insert({
          userid,
          accountid: template.accountid,
          categoryid: template.categoryid,
          amount: template.amount,
          transaction_type: template.category.category_type,
          transaction_date: cursor,
          description: template.description,
          recurringid: template.id,
        })
        .select()
        .single();

      if (insertError) {
        if (insertError.code === "23505") {
          // Someone else's request already generated this exact occurrence.
          // That's the desired outcome, not a failure -- move on as if this
          // insert had succeeded. Already reflected in the count `remaining`
          // was seeded from, so it doesn't get decremented again here.
          cursor = nextOccurrenceISO(cursor, template.frequency, template.interval_count, anchor);
          advanced = true;
          continue;
        }

        console.error(
          `[db:recurring] failed generating occurrence for ${template.id} on ${cursor}:`,
          insertError,
        );
        break;
      }

      created.push(row);
      cursor = nextOccurrenceISO(cursor, template.frequency, template.interval_count, anchor);
      advanced = true;
      remaining -= 1;
    }

    if (advanced && cursor !== template.next_run_date) {
      const { error: advanceError } = await supabase
        .from("recurring_transactions")
        .update({ next_run_date: cursor })
        .eq("id", template.id);

      if (advanceError) {
        console.error(
          `[db:recurring] failed advancing next_run_date for ${template.id}:`,
          advanceError,
        );
      }
    }
  }

  return { data: created, error: null };
});

// Wraps v_upcoming_recurring, bounded to a horizon -- the view itself has no
// date window (see CLAUDE.md "Recurring transactions"). No lower bound: an
// overdue template (is_overdue true, negative days_until) keeps showing
// rather than disappearing, since that's exactly what needs surfacing --
// under the lazy-catch-up model it should be rare and short-lived, not
// hidden.
export async function getUpcoming(daysAhead: number): Promise<DbResult<UpcomingRecurringRow[]>> {
  const supabase = await createClient();

  const horizon = addDaysISO(todayISO(), daysAhead);

  const { data, error } = await supabase
    .from("v_upcoming_recurring")
    .select("*")
    .lte("next_run_date", horizon)
    .order("next_run_date", { ascending: true });

  if (error) {
    return { data: null, error: describeReadError(error, "upcoming transactions") };
  }

  return { data, error: null };
}
