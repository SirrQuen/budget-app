// "Log again" (docs/Log-Again-and-Goal-Links.md, item 1): a past transaction
// becomes a PRE-FILLED add form, never a saved row. Pure: it shapes what the
// form starts with and changes no number.
//
// Copied: account, type, category, description, amount; a transfer's from,
// to, amount and description. NOT copied: notes, merchant, payment method,
// import_id, the schedule link, the pre-anchor answer (the form asks it
// afresh for the new date) and the date -- the form starts on today in the
// user's zone, which is its own default. The goal link joins the copied
// fields when transaction goal links exist (the spec's item 3).

import type { AddTransactionPrefill } from "@/app/(app)/transactions/AddTransactionForm";

export type LogAgainSource =
  | {
      kind: "single";
      description: string;
      amount: number;
      transaction_type: "Income" | "Expense";
      categoryid: string;
      accountid: string;
    }
  | {
      kind: "transfer";
      description: string;
      amount: number;
      fromAccountId: string;
      toAccountId: string;
    };

/** What the pickers can currently show -- an archived account or category can't be chosen again. */
export type LogAgainOptions = {
  accountIds: ReadonlySet<string>;
  incomeCategoryIds: ReadonlySet<string>;
  expenseCategoryIds: ReadonlySet<string>;
};

/**
 * The add form's starting values for a transaction logged again. A field the
 * pickers no longer offer (archived since) is left empty, so the form asks
 * for it rather than saving into something archived. `selectAmount` makes
 * the form open with the amount selected, so typing replaces it.
 */
export function logAgainPrefill(source: LogAgainSource, options: LogAgainOptions): AddTransactionPrefill {
  const amount = source.amount.toFixed(2);
  if (source.kind === "transfer") {
    return {
      transaction_type: "Transfer",
      description: source.description,
      amount,
      fromAccountId: options.accountIds.has(source.fromAccountId) ? source.fromAccountId : undefined,
      toAccountId: options.accountIds.has(source.toAccountId) ? source.toAccountId : undefined,
      selectAmount: true,
    };
  }
  const categoryIds = source.transaction_type === "Income" ? options.incomeCategoryIds : options.expenseCategoryIds;
  return {
    transaction_type: source.transaction_type,
    description: source.description,
    amount,
    categoryid: categoryIds.has(source.categoryid) ? source.categoryid : undefined,
    accountid: options.accountIds.has(source.accountid) ? source.accountid : undefined,
    selectAmount: true,
  };
}

/** One transaction as the "Recent" strip reads it. */
export type RecentRow = {
  description: string;
  amount: number;
  transaction_type: "Income" | "Expense";
  categoryid: string;
  accountid: string;
};

export const RECENT_LIMIT = 5;
/** How far back "Recent" looks, in days. */
export const RECENT_DAYS = 60;

/**
 * The most recent DISTINCT (description, account, category) combinations,
 * newest first -- `rows` must already be newest first, and each
 * combination keeps its newest row (so its newest amount). Description
 * compares without case or surrounding space. Combinations on an archived
 * account or category are skipped before the limit is applied, so the strip
 * isn't left short by entries it couldn't fill.
 */
export function recentCombinations(rows: readonly RecentRow[], options: LogAgainOptions): RecentRow[] {
  const seen = new Set<string>();
  const result: RecentRow[] = [];
  for (const row of rows) {
    const categoryIds = row.transaction_type === "Income" ? options.incomeCategoryIds : options.expenseCategoryIds;
    if (!options.accountIds.has(row.accountid) || !categoryIds.has(row.categoryid)) continue;
    const key = `${row.description.trim().toLowerCase()}|${row.accountid}|${row.categoryid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
    if (result.length === RECENT_LIMIT) break;
  }
  return result;
}

/** Tapping a "Recent" chip fills the form exactly as Log again does. */
export function recentPrefill(row: RecentRow, options: LogAgainOptions): AddTransactionPrefill {
  return logAgainPrefill({ kind: "single", ...row }, options);
}
