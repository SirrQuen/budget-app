import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { describeReadError } from "@/lib/db/errors";
import { getToday } from "@/lib/db/settings";
import { getFutureTransactions, getProjectionSchedules } from "@/lib/db/dashboard";
import {
  findSameBillPairs,
  sameBillKey,
  type SameBillDeletePreview,
  type SameBillPair,
} from "@/lib/sameBill";
import type { DbResult } from "@/lib/db/dashboard";

// Reads for "Is this the same bill?" (migration 66, lib/sameBill.ts). The
// match is lib/sameBill.ts's; this only gathers its inputs -- the same
// schedules and future rows the forecast counts, so a pair is asked about
// exactly when the forecast is counting both halves.

// Every unanswered pair for the signed-in user. cache()d: the dashboard,
// the edit page and an answer's server-side check read the same rows.
export const getSameBillPairs = cache(async (): Promise<DbResult<SameBillPair[]>> => {
  const supabase = await createClient();
  const [today, schedulesRes, futureRes, answersRes] = await Promise.all([
    getToday(),
    getProjectionSchedules(),
    getFutureTransactions(),
    supabase.from("same_bill_answers").select("recurringid, transactionid"),
  ]);
  if (schedulesRes.error !== null) return { data: null, error: schedulesRes.error };
  if (futureRes.error !== null) return { data: null, error: futureRes.error };
  if (answersRes.error) return { data: null, error: describeReadError(answersRes.error, "dashboard") };

  if (futureRes.data.length === 0 || schedulesRes.data.length === 0) {
    return { data: [], error: null };
  }

  // v_future_transactions doesn't carry recurringid; a linked row is
  // already some schedule's occurrence and is never asked about.
  const linkedRes = await supabase
    .from("transactions")
    .select("id")
    .in(
      "id",
      futureRes.data.map((t) => t.transactionId),
    )
    .not("recurringid", "is", null);
  if (linkedRes.error) return { data: null, error: describeReadError(linkedRes.error, "dashboard") };
  const linked = new Set(linkedRes.data.map((r) => r.id));

  return {
    data: findSameBillPairs(
      schedulesRes.data,
      futureRes.data.map((t) => ({
        transactionId: t.transactionId,
        kind: t.kind,
        accountId: t.accountId,
        toAccountId: t.toAccountId,
        amount: t.amount,
        date: t.date,
        linked: linked.has(t.transactionId),
      })),
      new Set(answersRes.data.map((a) => sameBillKey(a.recurringid, a.transactionid))),
      today,
    ),
    error: null,
  };
});

/** A "No, keep both" answer about one transaction, for its edit screen. */
export type DifferentBillAnswer = {
  recurringId: string;
  scheduleName: string;
  occurrenceDueDate: string;
};

// The "No" answers given about this transaction (either leg of a
// transfer: answers are stored on the Expense leg).
export async function getDifferentBillAnswers(
  transactionIds: string[],
): Promise<DbResult<DifferentBillAnswer[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("same_bill_answers")
    .select("recurringid, occurrence_due_date, recurring_transactions!same_bill_answers_recurringid_fkey(description)")
    .eq("answer", "different")
    .in("transactionid", transactionIds)
    .order("occurrence_due_date");
  if (error) return { data: null, error: describeReadError(error, "transaction") };
  return {
    data: data.map((r) => ({
      recurringId: r.recurringid,
      scheduleName: r.recurring_transactions?.description ?? "your schedule",
      occurrenceDueDate: r.occurrence_due_date,
    })),
    error: null,
  };
}

// What deleting each of these does to a "same bill" answer
// (same_bill_delete_preview, migration 66) -- for the delete
// confirmations. Ids of either transfer leg are fine.
export async function getSameBillDeletePreviews(
  transactionIds: string[],
): Promise<DbResult<SameBillDeletePreview[]>> {
  if (transactionIds.length === 0) return { data: [], error: null };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("same_bill_delete_preview", { p_transaction_ids: transactionIds });
  if (error) return { data: null, error: describeReadError(error, "transaction") };
  return {
    data: data.map((r) => ({
      transactionId: r.transaction_id,
      transferGroupId: r.transfer_group_id,
      scheduleName: r.schedule_name,
      occurrenceDueDate: r.occurrence_due_date,
      restores: r.restores,
      resumesOn: r.resumes_on,
    })),
    error: null,
  };
}
