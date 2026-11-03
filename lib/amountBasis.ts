// What an upcoming amount rests on, and how it's labelled: "$151 (average
// of last 3)", "$1,850 (fixed)". A number with its provenance is a number
// the user can judge (docs/Recurring-Amounts-and-Transfer-Editing.md, 1a).
//
// The basis is decided in SQL (v_recurring_amounts, migration 59) next to
// the amount itself, so a label can't describe a different rule from the
// one that produced the figure. This file only names them. Card payments
// past the next one are built by the projection from the card's own
// charges (lib/safeToSpendProjection.ts) -- "card_charges" is that case.

export const AMOUNT_BASES = [
  "fixed",
  "schedule",
  "average_of_3",
  "highest_of_3",
  "highest_so_far",
  "lowest_of_3",
  "lowest_so_far",
  "statement",
  "card_balance",
  "card_charges",
] as const;

export type AmountBasis = (typeof AMOUNT_BASES)[number];

const LABELS: Record<AmountBasis, string> = {
  fixed: "fixed",
  schedule: "your estimate",
  average_of_3: "average of last 3",
  highest_of_3: "highest of last 3",
  highest_so_far: "highest so far",
  lowest_of_3: "lowest of last 3",
  lowest_so_far: "lowest so far",
  statement: "statement",
  card_balance: "card balance",
  card_charges: "card charges",
};

export function amountBasisLabel(basis: AmountBasis): string {
  return LABELS[basis];
}

/**
 * Reads a basis column from the database. An unknown value is a schema
 * this code doesn't know yet -- thrown, not guessed, so a new basis can't
 * render under someone else's label.
 */
export function parseAmountBasis(value: string | null): AmountBasis | null {
  if (value === null) return null;
  if ((AMOUNT_BASES as readonly string[]).includes(value)) return value as AmountBasis;
  throw new Error(`Unknown amount basis: ${value}`);
}
