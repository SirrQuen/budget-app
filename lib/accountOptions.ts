// Shared between the account Server Actions (validation) and the
// create/edit account form (rendering) -- no "server-only" import so the
// client form can pull the same source of truth.

// Mirrors accounts_account_type_check (20260805000004_04_hardening.sql).
// Keep in sync if that constraint ever changes: `npm run test:parity`
// fails while they differ.
export const ACCOUNT_TYPES = [
  "Checking",
  "Savings",
  "Credit Card",
  "Loan",
  "Investment",
  "Cash",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

// Display order for the accounts list, grouped by type -- deliberately not
// alphabetical. Assets in the order people think about their money
// (most-used first), liabilities last, so it reads like a balance sheet.
export const ACCOUNT_TYPE_GROUP_ORDER: AccountType[] = [
  "Checking",
  "Savings",
  "Cash",
  "Investment",
  "Credit Card",
  "Loan",
];

// Mirrors accounts_liability_sign (20260822000006_06_liability_sign.sql):
// Credit Card and Loan balances are stored negative. Every place that reads
// or writes opening_balance needs to know which types those are.
export function isLiabilityAccountType(type: string): boolean {
  return type === "Credit Card" || type === "Loan";
}

export type PaymentPayee = "card" | "loan";

// Whether recording money into this account is paying someone else --
// the boundary for PaymentNote's "it doesn't move any money" line. Money
// owed to a third party gets it (a card, a loan); a move between the
// user's own accounts doesn't, or the line dilutes until nobody reads it.
// The one place this is decided.
export function paymentPayee(accountType: string | null | undefined): PaymentPayee | null {
  if (accountType === "Credit Card") return "card";
  if (accountType === "Loan") return "loan";
  return null;
}

// A variable-amount recurring schedule's live estimate, when there's no
// confirmed next_amount yet -- the card's current balance, negated (owed
// amounts are negative per accounts_liability_sign) and floored at zero so
// a card currently in credit (a positive balance) estimates as nothing
// owed, not that credit amount. No "server-only" here (unlike lib/db/*) so
// both a Server Component (RecurringPage, which has a balance from
// listAccountBalances) and a Client Component (RecurringRow, rendering it)
// can import this. Mirrors v_upcoming_recurring's own "amount" case
// expression (20260912000023_23_recurring_variable_amount.sql), which
// computes the same figure in SQL for every other reader (dashboard,
// safe-to-spend, the upcoming list).
export function estimateCardPaymentDue(cardBalance: number): number {
  return Math.max(-cardBalance, 0);
}
