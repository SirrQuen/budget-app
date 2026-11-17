// "Log it" (docs/Decide-and-Grow.md, F2): open the NORMAL add form, already
// filled in, from somewhere that doesn't hold the form's lists. The
// quick-add bar (on the dashboard, transactions and accounts) holds them and
// owns the full form, so it listens for this and opens it -- the save is
// then the ordinary new-transaction write, with its toast and questions.
// Nothing is saved by asking.

import type { AddTransactionPrefill } from "@/app/(app)/transactions/AddTransactionForm";

export const OPEN_ADD_FORM_EVENT = "sorrel:open-add-form";

export type OpenAddFormDetail = {
  prefill: AddTransactionPrefill;
  /** Set by the listener that opened it; false means nothing on this page could. */
  handled: boolean;
};

/** Asks the page's add form to open with `prefill`. true when one did. */
export function requestAddForm(prefill: AddTransactionPrefill): boolean {
  const detail: OpenAddFormDetail = { prefill, handled: false };
  window.dispatchEvent(new CustomEvent<OpenAddFormDetail>(OPEN_ADD_FORM_EVENT, { detail }));
  return detail.handled;
}

/** Integer cents as the form's amount text: 90050 -> "900.50". No float. */
export function centsToAmountText(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** What "Log it" fills in: an expense, the amount asked about, on the day asked about. */
export function whatIfPrefill(cents: number, date: string): AddTransactionPrefill {
  return { transaction_type: "Expense", amount: centsToAmountText(cents), transaction_date: date };
}
