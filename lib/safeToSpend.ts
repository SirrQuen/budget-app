// Pure classification for getSafeToSpend (lib/db/dashboard.ts) -- kept
// separate from the query so the seven-row decision table can be unit
// tested without a database round trip. This is the rule the whole
// function hangs on; every case is spelled out here once rather than
// re-derived at each call site.
//
// Safe-to-spend cash lives in Checking/Savings only (CLAUDE.md "Liability
// accounts" + the safe-to-spend rule this implements) -- Investment, Cash,
// Credit Card and Loan are never spendable balance.
export const SPENDABLE_ACCOUNT_TYPES: ReadonlySet<string> = new Set(["Checking", "Savings"]);

export function isSpendableAccountType(accountType: string): boolean {
  return SPENDABLE_ACCOUNT_TYPES.has(accountType);
}

export type SafeToSpendCandidate = {
  /** v_upcoming_recurring.category_type is null for a transfer template. */
  transactionType: "Expense" | "Transfer";
  /** The schedule's source account type (v_upcoming_recurring.account_type). */
  fromAccountType: string;
  /**
   * The schedule's destination account type -- null for an Expense (there is
   * no destination account, only a merchant), always set for a Transfer
   * (v_upcoming_recurring.to_account_type).
   */
  toAccountType: string | null;
};

// Whether an upcoming recurring row is a safe-to-spend commitment: cash
// leaving the spendable set (Checking/Savings) without landing back inside
// it before the window closes.
//
//   source not spendable  -> never a commitment, regardless of type. This
//     covers an Expense charged to a Credit Card (no cash moves until the
//     card is paid -- the card's own payment schedule is the commitment
//     that covers that) and anything drawn from Cash, Investment or Loan.
//   Expense, spendable source -> always a commitment (cash leaves for a
//     merchant, full stop).
//   Transfer, spendable source, spendable destination (e.g. Checking ->
//     Savings) -> NOT a commitment. The money is still spendable, just in
//     a different account.
//   Transfer, spendable source, non-spendable destination (e.g. Checking ->
//     Investment, or a card payment from Checking) -> a commitment.
export function isSafeToSpendCommitment(row: SafeToSpendCandidate): boolean {
  if (!isSpendableAccountType(row.fromAccountType)) {
    return false;
  }
  if (row.transactionType === "Transfer" && isSpendableAccountType(row.toAccountType ?? "")) {
    return false;
  }
  return true;
}
