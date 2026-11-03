// What a transfer does to safe to spend, for the transfer editor. Changing
// an account can move a transfer across the spendable set, which moves
// the hero number. That's correct and the classifier already does it
// (lib/safeToSpend.ts) -- but the editor shouldn't hide it
// (docs/Recurring-Amounts-and-Transfer-Editing.md, 4). Built on the one
// classifier; never a set of account types of its own.

import { isSafeToSpendCommitment, isSafeToSpendIncome } from "@/lib/safeToSpend";

export type TransferEffect = "out" | "in" | "none";

export function transferEffect(fromAccountType: string, toAccountType: string): TransferEffect {
  const row = { transactionType: "Transfer" as const, fromAccountType, toAccountType };
  if (isSafeToSpendCommitment(row)) return "out";
  if (isSafeToSpendIncome(row)) return "in";
  return "none";
}

/**
 * One factual line when an edit changes how safe to spend sees the
 * transfer; null when it doesn't. Names accounts, never alarms.
 */
export function transferEffectLine(
  before: TransferEffect,
  after: TransferEffect,
  fromName: string,
  toName: string,
): string | null {
  if (before === after) return null;
  if (after === "out") return `Safe to spend will count this as money leaving ${fromName}.`;
  if (after === "in") return `Safe to spend will count this as money arriving in ${toName}.`;
  return `Safe to spend won't count this: ${fromName} and ${toName} are on the same side.`;
}
