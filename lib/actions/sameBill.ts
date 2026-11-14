"use server";

import { revalidatePath } from "next/cache";
import { clearDifferentBill, confirmSameBill, recordDifferentBill } from "@/lib/db/recurring";
import { getSameBillPairs } from "@/lib/db/sameBill";

export type SameBillState = { error?: string } | undefined;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function revalidateSameBill() {
  revalidatePath("/dashboard");
  revalidatePath("/transactions", "layout");
  revalidatePath("/recurring");
}

// "Is this the same bill?" (docs/Views-Search-Import-Layout.md, item 4).
// Each answer is checked against the match as it stands now
// (lib/sameBill.ts, read fresh) -- the ids come from the client, so a pair
// that no longer matches, or never did, writes nothing. Keyed on the
// occurrence's due date like every queue answer: a stale question acts on
// nothing rather than on the next cycle.
async function currentPair(recurringId: string, transactionId: string, dueDate: string) {
  const pairs = await getSameBillPairs();
  if (pairs.error !== null) return { pair: null, error: pairs.error };
  return {
    pair:
      pairs.data.find(
        (p) => p.recurringId === recurringId && p.transactionId === transactionId && p.dueDate === dueDate,
      ) ?? null,
    error: null,
  };
}

/** "Yes, they're the same": the entry becomes the occurrence; the bill counts once. */
export async function confirmSameBillAction(
  recurringId: string,
  transactionId: string,
  dueDate: string,
): Promise<SameBillState> {
  if (!recurringId || !transactionId || !ISO_DATE.test(dueDate)) {
    return { error: "We couldn't tell which bill that was." };
  }
  const { pair, error } = await currentPair(recurringId, transactionId, dueDate);
  if (error !== null) return { error };
  // Already answered elsewhere (another tab, a second press): the outcome
  // asked for may already exist, so it succeeds quietly.
  if (pair === null) {
    revalidateSameBill();
    return;
  }

  const result = await confirmSameBill(recurringId, transactionId, dueDate);
  if (result.error !== null) return { error: result.error };
  if (result.data === "not_linkable") {
    return { error: "That entry is on a different account or direction from the schedule, so they can't be joined." };
  }
  revalidateSameBill();
}

/** "No, keep both": never asked about this pair again. Reversible on the transaction. */
export async function recordDifferentBillAction(
  recurringId: string,
  transactionId: string,
  dueDate: string,
): Promise<SameBillState> {
  if (!recurringId || !transactionId || !ISO_DATE.test(dueDate)) {
    return { error: "We couldn't tell which bill that was." };
  }
  const { pair, error } = await currentPair(recurringId, transactionId, dueDate);
  if (error !== null) return { error };
  if (pair === null) {
    revalidateSameBill();
    return;
  }
  const result = await recordDifferentBill(recurringId, transactionId, dueDate);
  if (result.error !== null) return { error: result.error };
  revalidateSameBill();
}

/** "Change your answer" on a "No": the question comes back if the pair still matches. */
export async function clearDifferentBillAction(recurringId: string, transactionId: string): Promise<SameBillState> {
  if (!recurringId || !transactionId) {
    return { error: "We couldn't tell which bill that was." };
  }
  const result = await clearDifferentBill(recurringId, transactionId);
  if (result.error !== null) return { error: result.error };
  revalidateSameBill();
}
