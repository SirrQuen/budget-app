"use server";

import { revalidatePath } from "next/cache";
import { makeTransfer, separateTransfer, type TurnIntoTransferInput } from "@/lib/db/transferConversions";
import type { GoalCompletion } from "@/lib/goalCompletion";
import { completedSince, completionSnapshot } from "@/lib/goalCompletionCheck";
import type { TransferOrigin } from "@/lib/turnIntoTransfer";

// "Turn into a transfer" (migration 80) and separating a transfer again.
// Each is one SQL call; every balance, Safe to Spend and the lists read
// it afterwards.

export type ActionResult<T> = { data: T; error?: undefined } | { data?: undefined; error: string };

/**
 * The write. A card payment made a transfer lowers what the card owes, so
 * it can finish a goal that follows the card: the completion snapshot is
 * taken like any other transaction write, and the completion returned
 * plays the bloom (lib/goalCompletionCheck.ts).
 */
export async function makeTransferAction(
  input: TurnIntoTransferInput,
): Promise<ActionResult<{ transferGroupId: string; completion?: GoalCompletion }>> {
  const before = await completionSnapshot();
  const result = await makeTransfer(input);
  if (result.error !== null) return { error: result.error };
  revalidatePath("/", "layout");
  const completion = await completedSince(before);
  return { data: { ...result.data, ...(completion ? { completion } : {}) } };
}

/** Undo, and "Separate them instead" (an import's side needs `categoryId`). */
export async function separateTransferAction(
  groupId: string,
  kind: TransferOrigin["kind"],
  categoryId: string | null = null,
): Promise<ActionResult<null>> {
  const result = await separateTransfer(groupId, kind, categoryId);
  if (result.error !== null) return { error: result.error };
  revalidatePath("/", "layout");
  return { data: null };
}
