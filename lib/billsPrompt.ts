// "Add your bills" (docs/Decide-and-Grow.md, G, addition 2026-11-17), pure.
//
// Right after onboarding the number counts a paycheck and no bills, so it
// overstates. Step 3 says so and offers the bills; someone who taps "Later"
// gets a dashboard card with the same choices. Both open the EXISTING
// recurring create form, prefilled. Nothing here writes, and a category is
// never created: a choice uses an existing active category when one fits,
// otherwise the form's own picker asks.
//
// The card is derived from data plus a dismiss cookie (lib/billsCardDismiss.ts):
// shown while fewer than BILLS_TARGET recurring expenses exist, for
// BILLS_PROMPT_DAYS after the first account was created, until dismissed --
// and only for someone whose first account is new since this shipped
// (BILLS_PROMPT_FROM), so existing users never see it.

import { addDaysISO, todayInZone } from "@/lib/date";
import { NEW_USERS_FROM, isNewSince } from "@/lib/onboarding";

export type BillChoice = {
  key: string;
  label: string;
  /** The schedule's prefilled name; "" for Other. */
  description: string;
  /** Existing default category names that fit, in order. Empty: always the picker. */
  categories: string[];
};

export const BILL_CHOICES: BillChoice[] = [
  { key: "rent", label: "Rent or mortgage", description: "Rent", categories: ["Rent", "Mortgages"] },
  { key: "phone", label: "Phone", description: "Phone", categories: ["Telephone"] },
  { key: "internet", label: "Internet", description: "Internet", categories: ["Utilities", "Cable/Satellite"] },
  { key: "car", label: "Car payment", description: "Car payment", categories: ["Automotive", "Loans"] },
  { key: "insurance", label: "Insurance", description: "Insurance", categories: ["Insurance"] },
  { key: "subscriptions", label: "Subscriptions", description: "Subscriptions", categories: ["Dues & Subscriptions", "Online Services"] },
  { key: "other", label: "Other", description: "", categories: [] },
];

/** Recurring expenses at which the card has done its job. */
export const BILLS_TARGET = 3;
/** Days after the first account's creation the card is offered for. */
export const BILLS_PROMPT_DAYS = 14;
/** The card is for people new since it shipped -- the same cutoff as step 2 (lib/onboarding.ts). */
export const BILLS_PROMPT_FROM = NEW_USERS_FROM;

/** The category a choice starts with: the first active one that fits, else null (the picker). */
export function billCategoryId(choice: BillChoice, activeExpenseCategories: { id: string; name: string }[]): string | null {
  for (const name of choice.categories) {
    const match = activeExpenseCategories.find((c) => c.name === name);
    if (match) return match.id;
  }
  return null;
}

/** Which choices already have a schedule, by its name -- the quiet "Added" check, derived. */
export function addedBillKeys(expenseScheduleNames: string[]): Set<string> {
  const names = new Set(expenseScheduleNames.map((n) => n.trim().toLowerCase()));
  return new Set(
    BILL_CHOICES.filter((c) => c.description !== "" && names.has(c.description.toLowerCase())).map((c) => c.key),
  );
}

export function billsCardVisible(input: {
  /** The user's first account's created_at, any account, archived included; null with none. */
  firstAccountCreatedAt: string | null;
  timeZone: string | null;
  today: string;
  /** Active recurring expenses (category schedules, not transfers). */
  expenseSchedules: number;
  dismissed: boolean;
}): boolean {
  if (input.dismissed || input.firstAccountCreatedAt === null) return false;
  if (!isNewSince(input.firstAccountCreatedAt)) return false;
  const created = new Date(input.firstAccountCreatedAt);
  if (input.expenseSchedules >= BILLS_TARGET) return false;
  const createdDay = todayInZone(input.timeZone, created);
  return input.today < addDaysISO(createdDay, BILLS_PROMPT_DAYS);
}
