import "server-only";
import { createClient } from "@/lib/supabase/server";
import { classifyDbError, describeReadError, UNREACHABLE, type DbError } from "@/lib/db/errors";
import { importQueueItems, readTransferCandidates } from "@/lib/db/imports";
import { getConfirmationQueue } from "@/lib/db/dashboard";
import { getSameBillCycle } from "@/lib/db/recurring";
import { findImportSameBill, type ImportSameBillItem } from "@/lib/sameBill";
import { addDaysISO } from "@/lib/date";
import { ANCHOR_ANSWER_REQUIRED, ANCHOR_ANSWER_STALE, type AnchorAnswerColumns } from "@/lib/anchorAnswer";
import type { TransferCandidate } from "@/lib/importTransfers";
import { TRANSFER_MATCH_DAYS } from "@/lib/importTransfers";
import type { TransferOrigin } from "@/lib/turnIntoTransfer";
import type { DbResult } from "@/lib/db/transactions";

// "Turn into a transfer" (migration 80), its Undo, and "Separate them
// instead" for a transfer an import joined (migration 76). Every write is
// one SQL function -- make_transfer(), undo_make_transfer(),
// separate_import_transfer() -- atomic and scoped to auth.uid(); this
// module calls them and says what they said.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GENERIC = "That didn't change, and nothing was saved. It's not something you did. Try again in a moment.";
const GONE = "That entry or account isn't available any more. Refresh the page and try again.";

/**
 * The functions' own messages (SMT01-03) are written for the person and
 * name nothing but their own goal; they're shown as they are. Anything
 * else Postgres said is never shown.
 */
function describeConversionError(error: DbError, what: string): string {
  console.warn(`[db:transfer-conversion] ${what} failed, code=${error.code || "none"}`);
  switch (classifyDbError(error)) {
    case "network-unreachable":
      return UNREACHABLE;
    case "auth-expired":
      return "Your session ended, so nothing was changed. Sign in again and try once more.";
    default:
      break;
  }
  if (["SMT01", "SMT02", "SMT03", "SMT04", "SMT05"].includes(error.code ?? "")) return error.message;
  if (error.code === "SRA01") return ANCHOR_ANSWER_REQUIRED;
  if (error.code === "SRA02") return ANCHOR_ANSWER_STALE;
  if (error.code === "P0002") return GONE;
  return GENERIC;
}

export type TurnIntoTransferInput = {
  transactionId: string;
  otherAccountId: string;
  /** An entry on the other account to join, or null to add the other side. */
  pairWith: string | null;
  /** The other account's pre-anchor answer for an added leg (migration 62). */
  anchor: AnchorAnswerColumns;
  /**
   * "Is this the same bill?" for an added side that matches a transfer
   * schedule's waiting occurrence (both ends, this way round) -- import's
   * question and match (findImportSameBill). Null when none was asked.
   */
  sameBill: { answer: "same" | "different"; recurringId: string; dueDate: string } | null;
};

const BILL_STALE = "A bill you matched has changed since, so nothing was changed. Look at it again.";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The queue items this entry's added side can be the same bill as: on its account, a transfer at either end. */
export async function getTurnIntoTransferQueue(accountId: string): Promise<DbResult<ImportSameBillItem[]>> {
  const queueRes = await getConfirmationQueue();
  if (queueRes.error !== null) return { data: null, error: queueRes.error };
  return { data: importQueueItems(queueRes.data, accountId), error: null };
}

export async function makeTransfer(input: TurnIntoTransferInput): Promise<DbResult<{ transferGroupId: string }>> {
  if (
    !UUID.test(input.transactionId) ||
    !UUID.test(input.otherAccountId) ||
    (input.pairWith !== null && !UUID.test(input.pairWith)) ||
    (input.sameBill !== null && (!UUID.test(input.sameBill.recurringId) || !ISO.test(input.sameBill.dueDate)))
  ) {
    return { data: null, error: GONE };
  }
  // A joined entry can't also take an occurrence (v1, as import).
  if (input.pairWith !== null && input.sameBill !== null) return { data: null, error: BILL_STALE };
  const supabase = await createClient();

  // The same-bill claim, checked against the queue as it stands NOW (the
  // ids come from the browser), as import checks its rows: an added side
  // that matches an occurrence must carry the answer, and an answer must
  // be for a match that still exists.
  let sameBillArgs: { p_same_bill?: Record<string, string>; p_different_bill?: Record<string, string> } = {};
  if (input.pairWith === null) {
    const { data: src, error: srcError } = await supabase
      .from("transactions")
      .select("accountid, transaction_type, transaction_date, amount")
      .eq("id", input.transactionId)
      .maybeSingle();
    if (srcError) return { data: null, error: describeReadError(srcError, "transaction") };
    if (!src) return { data: null, error: GONE };
    const queue = await getTurnIntoTransferQueue(src.accountid);
    if (queue.error !== null) return { data: null, error: queue.error };
    const m = findImportSameBill(
      [
        {
          row: 1,
          type: src.transaction_type as "Income" | "Expense",
          date: src.transaction_date,
          cents: Math.round(Number(src.amount) * 100),
          transferOtherAccountId: input.otherAccountId,
        },
      ],
      queue.data,
      src.accountid,
    )[0];
    const a = input.sameBill;
    if ((m === undefined) !== (a === null)) return { data: null, error: BILL_STALE };
    if (m && a) {
      if (a.recurringId !== m.recurringId || a.dueDate !== m.dueDate) return { data: null, error: BILL_STALE };
      if (a.answer === "same") {
        const cycle = await getSameBillCycle(a.recurringId, a.dueDate);
        if (cycle.error !== null) return { data: null, error: cycle.error };
        if (cycle.data === null) return { data: null, error: BILL_STALE };
        sameBillArgs = {
          p_same_bill: {
            recurringid: a.recurringId,
            from_run_date: cycle.data.fromRunDate,
            to_run_date: cycle.data.toRunDate,
            to_due_date: cycle.data.toDueDate,
          },
        };
      } else {
        sameBillArgs = { p_different_bill: { recurringid: a.recurringId, due_date: a.dueDate } };
      }
    }
  }

  const { data, error } = await supabase.rpc("make_transfer", {
    p_transactionid: input.transactionId,
    p_other_accountid: input.otherAccountId,
    ...(input.pairWith !== null ? { p_pair_with: input.pairWith } : {}),
    ...(input.anchor.counts_despite_anchor !== null && input.anchor.anchor_answer_set_at !== null
      ? { p_counts_despite_anchor: input.anchor.counts_despite_anchor, p_anchor_set_at: input.anchor.anchor_answer_set_at }
      : {}),
    ...sameBillArgs,
  });
  if (error) return { data: null, error: describeConversionError(error, "make") };
  return { data: { transferGroupId: data }, error: null };
}

const CATEGORY_NEEDED = "Choose a category for the entry from your file.";

/**
 * Undo, and "Separate them instead": which function depends on where the
 * transfer came from. An import's side stays and needs a category to
 * stand on its own (ruled 2026-11-24), so `categoryId` is required then.
 */
export async function separateTransfer(
  groupId: string,
  kind: TransferOrigin["kind"],
  categoryId: string | null,
): Promise<DbResult<null>> {
  if (!UUID.test(groupId)) return { data: null, error: GONE };
  if (kind === "import" && (categoryId === null || !UUID.test(categoryId))) return { data: null, error: CATEGORY_NEEDED };
  const supabase = await createClient();
  const { error } =
    kind === "conversion"
      ? await supabase.rpc("undo_make_transfer", { p_transfer_group_id: groupId })
      : await supabase.rpc("separate_import_transfer", { p_transfer_group_id: groupId, p_categoryid: categoryId as string });
  if (error) return { data: null, error: describeConversionError(error, "separate") };
  return { data: null, error: null };
}

/**
 * Where each of these transfers came from, for the ones that can be
 * separated: a conversion, or an import that joined an existing entry.
 * Transfers made any other way are simply absent from the map. Read
 * under RLS; a failed read returns the error and the caller shows the
 * plain dialog.
 */
export async function getTransferOrigins(groupIds: readonly string[]): Promise<DbResult<Map<string, TransferOrigin>>> {
  const ids = [...new Set(groupIds.filter((g) => UUID.test(g)))];
  const out = new Map<string, TransferOrigin>();
  if (ids.length === 0) return { data: out, error: null };
  const supabase = await createClient();

  type Conv = {
    transfer_group_id: string;
    source_transactionid: string;
    source_prior_categoryid: string;
    joined_transactionid: string | null;
    joined_prior_categoryid: string | null;
    created_transactionid: string | null;
    created_at: string;
  };
  type Pair = { transfer_group_id: string; transactionid: string; prior_categoryid: string; created_at: string };
  const convs: Conv[] = [];
  const pairs: Pair[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const [c, p] = await Promise.all([
      supabase
        .from("transfer_conversions")
        .select("transfer_group_id, source_transactionid, source_prior_categoryid, joined_transactionid, joined_prior_categoryid, created_transactionid, created_at")
        .in("transfer_group_id", chunk),
      supabase.from("import_pairings").select("transfer_group_id, transactionid, prior_categoryid, created_at").in("transfer_group_id", chunk),
    ]);
    if (c.error) return { data: null, error: describeReadError(c.error, "transfers") };
    if (p.error) return { data: null, error: describeReadError(p.error, "transfers") };
    convs.push(...c.data);
    pairs.push(...p.data);
  }
  const found = [...new Set([...convs.map((c) => c.transfer_group_id), ...pairs.map((p) => p.transfer_group_id)])];
  if (found.length === 0) return { data: out, error: null };

  // The legs as they are now, their accounts and the categories they'll go back to.
  type Leg = { id: string; transfer_group_id: string | null; description: string; accountid: string; updated_at: string; transaction_type: string };
  const legs: Leg[] = [];
  for (let i = 0; i < found.length; i += 100) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, transfer_group_id, description, accountid, updated_at, transaction_type")
      .in("transfer_group_id", found.slice(i, i + 100));
    if (error) return { data: null, error: describeReadError(error, "transfers") };
    legs.push(...data);
  }
  const accountIds = [...new Set(legs.map((l) => l.accountid))];
  const categoryIds = [
    ...new Set([
      ...convs.flatMap((c) => [c.source_prior_categoryid, c.joined_prior_categoryid].filter((x): x is string => x !== null)),
      ...pairs.map((p) => p.prior_categoryid),
    ]),
  ];
  const [accountsRes, categoriesRes] = await Promise.all([
    supabase.from("accounts").select("id, account_name").in("id", accountIds),
    supabase.from("categories").select("id, category_name").in("id", categoryIds),
  ]);
  if (accountsRes.error) return { data: null, error: describeReadError(accountsRes.error, "accounts") };
  if (categoriesRes.error) return { data: null, error: describeReadError(categoriesRes.error, "categories") };
  const accountName = new Map(accountsRes.data.map((a) => [a.id, a.account_name]));
  const categoryName = new Map(categoriesRes.data.map((c) => [c.id, c.category_name]));
  const legById = new Map(legs.map((l) => [l.id, l]));
  const leg = (id: string | null) => {
    const l = id ? legById.get(id) : undefined;
    return l
      ? {
          id: l.id,
          description: l.description,
          accountName: accountName.get(l.accountid) ?? "another account",
          type: l.transaction_type as "Income" | "Expense",
        }
      : null;
  };
  // Edited since: a leg changed after the transfer was made (the write
  // itself stamps them in the same transaction, so equal is "not since").
  const editedSince = (groupId: string, at: string) =>
    legs.some((l) => l.transfer_group_id === groupId && Date.parse(l.updated_at) > Date.parse(at));

  for (const c of convs) {
    const source = leg(c.source_transactionid);
    const other = leg(c.joined_transactionid ?? c.created_transactionid);
    if (!source || !other) continue;
    out.set(c.transfer_group_id, {
      kind: "conversion",
      transferGroupId: c.transfer_group_id,
      source,
      sourceCategory: categoryName.get(c.source_prior_categoryid) ?? "its category",
      other,
      otherCategory: c.joined_prior_categoryid ? (categoryName.get(c.joined_prior_categoryid) ?? "its category") : null,
      edited: editedSince(c.transfer_group_id, c.created_at),
    });
  }
  for (const p of pairs) {
    const kept = leg(p.transactionid);
    const importedLeg = legs.find((l) => l.transfer_group_id === p.transfer_group_id && l.id !== p.transactionid);
    const imported = importedLeg ? leg(importedLeg.id) : null;
    if (!kept || !imported) continue;
    out.set(p.transfer_group_id, {
      kind: "import",
      transferGroupId: p.transfer_group_id,
      kept,
      keptCategory: categoryName.get(p.prior_categoryid) ?? "its category",
      imported,
      edited: editedSince(p.transfer_group_id, p.created_at),
    });
  }
  return { data: out, error: null };
}

/**
 * What the editor's "Turn into a transfer" needs, read when the page
 * loads: the person's entries on their OTHER active accounts within the
 * match window, each marked joinable or not (migration 76's rule, said
 * here so the screen asks only what the server will accept; the server
 * checks it again). The device picks the match.
 */
export async function getTurnIntoTransferCandidates(
  transaction: { id: string; date: string },
  otherAccountIds: readonly string[],
): Promise<DbResult<TransferCandidate[]>> {
  const supabase = await createClient();
  const res = await readTransferCandidates(
    supabase,
    [...otherAccountIds],
    addDaysISO(transaction.date, -TRANSFER_MATCH_DAYS),
    addDaysISO(transaction.date, TRANSFER_MATCH_DAYS),
  );
  if (res.error !== null) return res;
  return { data: res.data.filter((c) => c.id !== transaction.id), error: null };
}