// Shared between the account Server Actions (validation) and the
// create/edit account form (rendering) -- no "server-only" import so the
// client form can pull the same source of truth.

// Mirrors accounts_account_type_check (20260805000004_04_hardening.sql).
// Keep in sync if that constraint ever changes.
export const ACCOUNT_TYPES = [
  "Checking",
  "Savings",
  "Credit Card",
  "Loan",
  "Investment",
  "Cash",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

// Mirrors accounts_liability_sign (20260822000006_06_liability_sign.sql):
// Credit Card and Loan balances are stored negative. Every place that reads
// or writes opening_balance needs to know which types those are.
export function isLiabilityAccountType(type: string): boolean {
  return type === "Credit Card" || type === "Loan";
}
