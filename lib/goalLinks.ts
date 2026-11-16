// A transaction can be for a goal (migration 69,
// docs/Log-Again-and-Goal-Links.md section 3). Pure rules for the form and
// the server action. The database enforces the same shape on its own:
// only an Expense row carries a goal (transactions_goal_expense_only), and
// a transfer carries it on its Expense leg.

import { isSpendableAccountType } from "@/lib/safeToSpend";

export type FormTransactionType = "Income" | "Expense" | "Transfer";

/**
 * Whether a transaction of this type can be for a goal. Income never is in
 * v1: it lands in spendable money, and counting it as saved while it's
 * still spendable counts the same dollars twice. Move it to savings, then
 * link the transfer.
 */
export function goalLinkable(type: FormTransactionType): boolean {
  return type === "Expense" || type === "Transfer";
}

/**
 * Where a goal is likely, the Goal field opens itself and asks "Is this for
 * a goal?": a transfer from a spendable account to one that isn't (checking
 * to savings). The set is lib/safeToSpend.ts's -- never restated here. Still
 * optional, still defaulting to none.
 */
export function goalFieldAsks(
  type: FormTransactionType,
  fromAccountType: string | undefined,
  toAccountType: string | undefined,
): boolean {
  if (type !== "Transfer" || !fromAccountType || !toAccountType) return false;
  return isSpendableAccountType(fromAccountType) && !isSpendableAccountType(toAccountType);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The goal a submitted form names, or null. Null for a type that can't
 * carry one, so switching an expense to income clears its goal rather
 * than asking the database to refuse it.
 */
export function parseGoalId(raw: FormDataEntryValue | null, type: FormTransactionType): string | null {
  if (!goalLinkable(type)) return null;
  const value = typeof raw === "string" ? raw.trim() : "";
  return UUID_RE.test(value) ? value : null;
}

/** "Is this the same money?" -- a hand-entered contribution the link may duplicate (same_goal_money, migration 69). */
export type SameMoneyPair = {
  /** The linked transaction (a transfer's Expense leg). */
  transactionId: string;
  contributionId: string;
  goalName: string;
  amount: number;
  /** The hand entry's date, YYYY-MM-DD. */
  contributionDate: string;
};

/** The delete confirmation's sentence for a row that counts toward a goal. */
export function goalDeleteNote(goalName: string | null | undefined): string | undefined {
  return goalName ? `It also comes off your ${goalName} goal.` : undefined;
}
