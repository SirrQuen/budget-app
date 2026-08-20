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
