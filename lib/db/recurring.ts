import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { describeReadError, describeWriteError, logDbError, sessionUserId } from "@/lib/db/errors";
import { getToday } from "@/lib/db/settings";
import { resolveDueDate, type NonBusinessDayRule } from "@/lib/businessDays";
import { getBankHolidays } from "@/lib/db/holidays";
import { nextOccurrenceISO } from "@/lib/recurringCadence";
import { confirmEach, type BulkConfirmResult } from "@/lib/confirmationQueue";

type RecurringRow = Database["public"]["Tables"]["recurring_transactions"]["Row"];
type RecurringInsert = Database["public"]["Tables"]["recurring_transactions"]["Insert"];
type RecurringUpdate = Database["public"]["Tables"]["recurring_transactions"]["Update"];
type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];

export type DbResult<T> = { data: T; error: null } | { data: null; error: string };

export type RecurringWithRelations = RecurringRow & {
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
  // Needed by the edit form to pre-select Income/Expense -- see CLAUDE.md
  // "Recurring transactions": the schedule carries no transaction_type of
  // its own, direction always comes from the linked category. Null for a
  // transfer template (to_accountid set) -- it has no category at all,
  // same as a transfer transaction's own categoryid.
  category_type: string | null;
  account_name: string | null;
  // Destination account name for a transfer template; null for an
  // ordinary category schedule.
  to_account_name: string | null;
};

// categoryid/accountid have FK relationships to several relations (base
// tables, plus reporting views) -- naming "categories"/"accounts" explicitly
// picks the base-table relationship, same as transactions.ts's TRANSACTION_SELECT.
// accountid and to_accountid both reference accounts, so each embed names
// its FK constraint explicitly (!recurring_transactions_..._fkey) --
// PostgREST can't otherwise tell which column a bare "accounts" embed means.
const RECURRING_SELECT =
  "*, category:categories(category_name, color, icon, category_type)," +
  " account:accounts!recurring_transactions_accountid_fkey(account_name)," +
  " to_account:accounts!recurring_transactions_to_accountid_fkey(account_name)";

type RawRecurringRow = RecurringRow & {
  category: { category_name: string; color: string | null; icon: string | null; category_type: string } | null;
  account: { account_name: string } | null;
  to_account: { account_name: string } | null;
};

function flatten(row: RawRecurringRow): RecurringWithRelations {
  const { category, account, to_account, ...rest } = row;
  return {
    ...rest,
    category_name: category?.category_name ?? null,
    category_color: category?.color ?? null,
    category_icon: category?.icon ?? null,
    category_type: category?.category_type ?? null,
    account_name: account?.account_name ?? null,
    to_account_name: to_account?.account_name ?? null,
  };
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

// Shared by createRecurring/updateRecurring: next_due_date is the resolved
// (business-day-adjusted) date derived from next_run_date/
// business_day_offset/non_business_day_rule -- see
// 20260914000024_24_recurring_business_day_rules.sql for why this is
// written by the app rather than computed live in SQL. lib/businessDays.ts
// is the actual implementation; this just supplies it with the holiday set.
async function computeNextDueDate(
  nextRunDateISO: string,
  businessDayOffset: number,
  nonBusinessDayRule: string,
): Promise<string> {
  const holidaysRes = await getBankHolidays();
  const holidays = holidaysRes.data ?? new Set<string>();
  return resolveDueDate(
    nextRunDateISO,
    businessDayOffset,
    nonBusinessDayRule as NonBusinessDayRule,
    holidays,
  );
}

export type CreateRecurringInput = Omit<
  RecurringInsert,
  "userid" | "id" | "created_at" | "is_active" | "next_due_date"
>;

export async function createRecurring(
  input: CreateRecurringInput,
): Promise<DbResult<RecurringRow>> {
  const supabase = await createClient();

  const session = sessionUserId(await supabase.auth.getClaims(), "recurring");
  if (session.userid === null) {
    return { data: null, error: session.error };
  }
  const { userid } = session;

  const next_due_date = await computeNextDueDate(
    input.next_run_date,
    input.business_day_offset ?? 0,
    input.non_business_day_rule ?? "none",
  );

  const { data, error } = await supabase
    .from("recurring_transactions")
    .insert({ ...input, userid, next_due_date })
    .select()
    .single();

  if (error) {
    return { data: null, error: describeWriteError(error, "recurring") };
  }

  return { data, error: null };
}

export type UpdateRecurringPatch = Omit<
  RecurringUpdate,
  "id" | "userid" | "created_at" | "next_due_date"
>;

// Recomputes next_due_date whenever the patch touches next_run_date -- the
// one field every real edit submits (RecurringForm always sends it,
// alongside business_day_offset/non_business_day_rule together -- see
// lib/actions/recurring.ts's parseRecurringFields). A hypothetical future
// caller that changes business_day_offset/non_business_day_rule WITHOUT
// next_run_date would leave next_due_date stale; v_integrity_issues'
// recurring_due_date_stale branch exists to catch exactly that.
export async function updateRecurring(
  id: string,
  patch: UpdateRecurringPatch,
): Promise<DbResult<RecurringRow>> {
  const supabase = await createClient();

  const fullPatch: RecurringUpdate = { ...patch };
  if (patch.next_run_date !== undefined) {
    fullPatch.next_due_date = await computeNextDueDate(
      patch.next_run_date,
      patch.business_day_offset ?? 0,
      patch.non_business_day_rule ?? "none",
    );
  }

  const { data, error } = await supabase
    .from("recurring_transactions")
    .update(fullPatch)
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
// also gates v_upcoming_recurring, so a paused template quietly stops
// appearing as a commitment and in the confirmation queue without losing
// its settings.
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
// for a few months would come back as a backlog of missed cycles -- counted
// against today in the projection and waiting in the confirmation queue --
// the opposite of what pausing was for. next_run_date only ever moves forward here: a template
// that's still due today or ahead of schedule is untouched.
export async function resumeRecurring(id: string): Promise<DbResult<RecurringRow>> {
  const supabase = await createClient();
  const today = await getToday();

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

// Sets the statement amount for a variable card payment's NEXT occurrence
// only -- a revision of the expectation, never a transaction. The
// projection and the queue's "landed as expected" both use it; answering
// that occurrence (confirmOccurrence/skipOccurrence) clears both fields
// (see rectx_next_amount_confirmed_together). The
// amount_is_variable filter is for intent, not security (RLS already scopes
// this to the caller's own row) -- it stops a stray call from writing
// next_amount onto a fixed-amount schedule, which rectx_next_amount_
// requires_variable would reject anyway; this just fails with a clearer
// "not found" instead of a constraint violation.
export async function confirmVariableAmount(
  id: string,
  amount: number,
): Promise<DbResult<RecurringRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("recurring_transactions")
    .update({ next_amount: amount, next_amount_confirmed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("amount_is_variable", true)
    .select()
    .single();

  if (error) {
    return { data: null, error: describeWriteError(error, "recurring") };
  }

  return { data, error: null };
}

// Mean of the last three confirmed Income transactions linked by
// recurringid, falling back to the schedule's own `amount` with fewer than
// three -- the one canonical implementation (estimate_income_amount,
// 29_recurring_income_confirmation.sql), called here via .rpc() for the
// recurring list page, which reads the base recurring_transactions table
// rather than v_upcoming_recurring (that view already calls the same
// function for every other reader -- dashboard, safe-to-spend, the
// upcoming list -- so a paused schedule, which the view's is_active filter
// excludes, still gets an estimate here). CLAUDE.md: never aggregate money
// in JavaScript -- this stays a single SQL round trip, never a client-side
// average over fetched rows.
export async function estimateIncomeAmount(
  recurringId: string,
  fallbackAmount: number,
): Promise<DbResult<number>> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("estimate_income_amount", {
    p_recurring_id: recurringId,
    p_fallback_amount: fallbackAmount,
  });

  if (error) {
    return { data: null, error: describeReadError(error, "recurring transactions") };
  }

  return { data: data ?? fallbackAmount, error: null };
}

// Same as estimateIncomeAmount, but the Expense counterpart
// (estimate_expense_amount, 31_recurring_expense_variability.sql), for the
// recurring list page for the same reason.
export async function estimateExpenseAmount(
  recurringId: string,
  fallbackAmount: number,
): Promise<DbResult<number>> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("estimate_expense_amount", {
    p_recurring_id: recurringId,
    p_fallback_amount: fallbackAmount,
  });

  if (error) {
    return { data: null, error: describeReadError(error, "recurring transactions") };
  }

  return { data: data ?? fallbackAmount, error: null };
}

// The schedule fields a confirmation needs. Read from v_upcoming_recurring,
// not the base table, so "landed as expected" writes the same predicted
// amount the queue showed -- the view is where that figure is decided (the
// fixed amount, a confirmed statement amount, a card's balance owed, or
// the income/expense estimate). A paused or finished schedule isn't in the
// view, and has nothing to confirm.
const CONFIRM_SELECT =
  "recurring_id, description, amount, accountid, categoryid, to_accountid, category_type, next_run_date, next_due_date, start_date, frequency, interval_count, business_day_offset, non_business_day_rule, next_amount, next_amount_confirmed_at";

type ConfirmScheduleRow = {
  recurring_id: string;
  description: string;
  amount: number;
  accountid: string;
  // Null for a transfer template -- to_accountid is set instead.
  categoryid: string | null;
  to_accountid: string | null;
  category_type: string | null;
  next_run_date: string;
  next_due_date: string;
  start_date: string | null;
  frequency: string;
  interval_count: number;
  business_day_offset: number;
  non_business_day_rule: string;
  next_amount: number | null;
  next_amount_confirmed_at: string | null;
};

// The transaction row(s) one confirmed occurrence writes. A transfer
// template writes both legs in one insert statement -- one call, one
// transaction, so a failure can't land only one leg (same reason
// createTransfer batches its two legs together). Both legs carry the
// template's recurringid, so they show the recurring icon and link back.
function occurrenceRows(
  s: ConfirmScheduleRow,
  userid: string,
  amount: number,
  date: string,
): TransactionInsert[] {
  if (s.to_accountid !== null) {
    const leg = {
      userid,
      categoryid: null,
      amount,
      transaction_date: date,
      description: s.description,
      recurringid: s.recurring_id,
      transfer_group_id: crypto.randomUUID(),
    };
    return [
      { ...leg, accountid: s.accountid, transaction_type: "Expense" },
      { ...leg, accountid: s.to_accountid, transaction_type: "Income" },
    ];
  }
  return [
    {
      userid,
      accountid: s.accountid,
      categoryid: s.categoryid,
      amount,
      // A category schedule carries no transaction_type of its own --
      // direction comes from its category (rectx_category_required
      // guarantees one), the same rule enforce_category_type checks.
      transaction_type: s.category_type!,
      transaction_date: date,
      description: s.description,
      recurringid: s.recurring_id,
    },
  ];
}

export type ConfirmOutcome = "answered" | "already_answered";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Reads the schedule an answer is about. data null with no error means
// the occurrence was already answered -- another tab, a second press, or
// a bulk confirm that got there first. Answering is keyed on the
// occurrence's due date, so a stale button can never act on the cycle
// after the one it showed.
async function readOpenOccurrence(
  supabase: Supabase,
  id: string,
  dueDate: string,
): Promise<DbResult<ConfirmScheduleRow | null>> {
  const { data, error } = await supabase
    .from("v_upcoming_recurring")
    .select(CONFIRM_SELECT)
    .eq("recurring_id", id)
    .maybeSingle()
    .returns<ConfirmScheduleRow>();

  if (error) {
    return { data: null, error: describeReadError(error, "recurring transaction") };
  }
  if (!data) {
    return { data: null, error: "That schedule isn't there anymore." };
  }
  return { data: data.next_due_date === dueDate ? data : null, error: null };
}

// Moves a schedule one cycle on, and is the claim on the occurrence: the
// update only applies while next_run_date is still the one read, so of two
// racing answers exactly one advances it, and only that one writes. A
// staged statement amount belongs to the cycle just answered, so it clears.
async function advanceOneCycle(
  supabase: Supabase,
  s: ConfirmScheduleRow,
): Promise<DbResult<boolean>> {
  const cursor = nextOccurrenceISO(
    s.next_run_date,
    s.frequency,
    s.interval_count,
    s.start_date ?? s.next_run_date,
  );
  const patch: RecurringUpdate = {
    next_run_date: cursor,
    next_due_date: await computeNextDueDate(cursor, s.business_day_offset, s.non_business_day_rule),
    next_amount: null,
    next_amount_confirmed_at: null,
  };

  const { data, error } = await supabase
    .from("recurring_transactions")
    .update(patch)
    .eq("id", s.recurring_id)
    .eq("next_run_date", s.next_run_date)
    .select("id");

  if (error) {
    return { data: null, error: describeWriteError(error, "recurring") };
  }
  return { data: data.length > 0, error: null };
}

export type ConfirmOccurrenceInput = {
  /** The occurrence being answered -- the queue item's dueDate. */
  dueDate: string;
  /** "Landed differently": the real amount. Omitted = the predicted amount. */
  amount?: number;
  /** "Landed differently": the real date. Omitted = the predicted date. */
  date?: string;
};

// The ONLY path from a schedule to a transaction (CLAUDE.md "Confirmation
// creates every recurring transaction"), for every type -- Income, Expense,
// Transfer, card payment. Reached only from a user's answer in the
// confirmation queue: "landed as expected" (no amount/date) and "landed
// differently" (either or both edited). The confirmed date IS the
// transaction date; there is no second date anywhere.
//
// "As expected" dates the transaction on the predicted date -- or today,
// if the queue opened early (date_tolerance_days) and it landed before the
// predicted date. A date after today is refused: it hasn't landed yet,
// which is a different answer.
//
// Claim, then write: advanceOneCycle first, so a double submit writes once.
// If the insert then fails the schedule is put back, so the occurrence
// stays open (and counted) rather than silently skipped.
export async function confirmOccurrence(
  id: string,
  input: ConfirmOccurrenceInput,
): Promise<DbResult<ConfirmOutcome>> {
  const supabase = await createClient();

  const session = sessionUserId(await supabase.auth.getClaims(), "recurring");
  if (session.userid === null) {
    return { data: null, error: session.error };
  }
  const { userid } = session;

  const read = await readOpenOccurrence(supabase, id, input.dueDate);
  if (read.error !== null) return read;
  const s = read.data;
  if (s === null) return { data: "already_answered", error: null };

  const today = await getToday();
  const amount = input.amount ?? Number(s.amount);
  const date = input.date ?? (s.next_due_date <= today ? s.next_due_date : today);

  if (!Number.isFinite(amount) || amount <= 0) {
    return { data: null, error: "Enter the amount that landed." };
  }
  if (date > today) {
    return { data: null, error: "That date hasn't happened yet. Choose today or earlier." };
  }

  const claim = await advanceOneCycle(supabase, s);
  if (claim.error !== null) return claim;
  if (!claim.data) return { data: "already_answered", error: null };

  const { error: insertError } = await supabase
    .from("transactions")
    .insert(occurrenceRows(s, userid, amount, date));

  if (insertError) {
    const { error: restoreError } = await supabase
      .from("recurring_transactions")
      .update({
        next_run_date: s.next_run_date,
        next_due_date: s.next_due_date,
        next_amount: s.next_amount,
        next_amount_confirmed_at: s.next_amount_confirmed_at,
      })
      .eq("id", id);
    if (restoreError) {
      logDbError(`[db:recurring] failed restoring ${id} after a failed confirmation:`, restoreError);
    }
    // recurring_tx_no_double_post: this schedule already has a transaction
    // of this type on that date (two cycles confirmed onto one day).
    if (insertError.code === "23505") {
      return {
        data: null,
        error: `${s.description} already has a transaction on that date. Choose the day this one landed.`,
      };
    }
    return { data: null, error: describeWriteError(insertError, "transaction") };
  }

  return { data: "answered", error: null };
}

// "Not happening": drop this one occurrence -- skipped, cancelled,
// refunded. Writes no transaction; the schedule stands and moves on to its
// next cycle. Same claim as confirmOccurrence, so it's safe to double-submit.
export async function skipOccurrence(
  id: string,
  dueDate: string,
): Promise<DbResult<ConfirmOutcome>> {
  const supabase = await createClient();

  const read = await readOpenOccurrence(supabase, id, dueDate);
  if (read.error !== null) return read;
  if (read.data === null) return { data: "already_answered", error: null };

  const claim = await advanceOneCycle(supabase, read.data);
  if (claim.error !== null) return claim;
  return { data: claim.data ? "answered" : "already_answered", error: null };
}

// "Confirm all as expected": exactly the items the user was shown, each
// confirmed once at its predicted date and amount -- one cycle per
// schedule per press, never a catch-up. Sequential and independent: one
// failure doesn't stop the rest, and is reported by name.
export async function confirmOccurrencesAsExpected(
  items: { id: string; dueDate: string }[],
): Promise<BulkConfirmResult> {
  return confirmEach(items, (item) => confirmOccurrence(item.id, { dueDate: item.dueDate }));
}
