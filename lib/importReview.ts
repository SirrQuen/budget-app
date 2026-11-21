// What the import preview works out from the file's rows, the account's
// existing transactions and the database's answers -- pure, so every rule
// is tested without a browser or a database (lib/importReview.test.ts).
// docs/Import-CSV.md, steps 6-9.
//
// The BALANCE RULE is not here. Whether a row dated D counts toward the
// balance is counts_in_balance() in SQL; import_preview() (migration 68)
// reports, per date, how a row on it is treated, and this file only
// applies the person's one answer and adds up INTEGER CENTS. A JavaScript
// copy of the rule is the failure this project has dug out of three times.

import { daysBetweenInclusive } from "@/lib/date";
import type { ImportType } from "@/lib/importCsv";

// ---------------------------------------------------------------------
// Possible duplicates (step 8)
// ---------------------------------------------------------------------

/** A bank dates a charge when it posts; a hand entry, when it happened. */
export const DUPLICATE_WINDOW_DAYS = 3;

export type ExistingTransaction = {
  id: string;
  date: string;
  cents: number;
  description: string;
  type: ImportType;
};

export type DuplicateMatch = {
  existing: ExistingTransaction;
  /** Whole days between the two dates. */
  gapDays: number;
};

const gap = (a: string, b: string) => Math.abs(daysBetweenInclusive(a, b) - 1);

/**
 * A row is a possible duplicate when an existing transaction on the same
 * account has the same amount and a date within three days. Rows within the
 * file are never compared with each other: two $5.75 coffees on one day are
 * two coffees. Nothing is merged or removed -- this only flags, in a preview
 * the person controls, and a flagged row is skipped unless they include it.
 * The closest date wins, then the earlier one, then the id.
 */
export function findDuplicates(
  rows: readonly { row: number; date: string; cents: number }[],
  existing: readonly ExistingTransaction[],
): Map<number, DuplicateMatch> {
  const byCents = new Map<number, ExistingTransaction[]>();
  for (const e of existing) {
    const list = byCents.get(e.cents);
    if (list) list.push(e);
    else byCents.set(e.cents, [e]);
  }

  const found = new Map<number, DuplicateMatch>();
  for (const r of rows) {
    let best: DuplicateMatch | null = null;
    for (const e of byCents.get(r.cents) ?? []) {
      const g = gap(r.date, e.date);
      if (g > DUPLICATE_WINDOW_DAYS) continue;
      if (
        best === null ||
        g < best.gapDays ||
        (g === best.gapDays && (e.date < best.existing.date || (e.date === best.existing.date && e.id < best.existing.id)))
      ) {
        best = { existing: e, gapDays: g };
      }
    }
    if (best) found.set(r.row, best);
  }
  return found;
}

/**
 * The server's re-run of the duplicate check (docs/Import-CSV.md, step 8).
 * The browser decides which flagged rows to include, but the browser is not
 * trusted: the server runs findDuplicates() itself against what the account
 * holds NOW and returns the rows that are flagged and weren't explicitly
 * marked as included. A non-empty answer refuses the whole import.
 *
 * Not a hard block: a row the person ticked ("Include") carries
 * includeDuplicate and passes, so two identical real purchases stay
 * possible. A row marked included that isn't flagged is harmless and passes.
 */
export function unincludedDuplicates(
  rows: readonly { row: number; date: string; cents: number; includeDuplicate: boolean }[],
  existing: readonly ExistingTransaction[],
): number[] {
  const flagged = findDuplicates(rows, existing);
  return rows.filter((r) => flagged.has(r.row) && !r.includeDuplicate).map((r) => r.row);
}

// ---------------------------------------------------------------------
// Categories (step 9)
// ---------------------------------------------------------------------

export type CategoryOption = { id: string; name: string; type: ImportType };

/** Rows that share a category name (or the lack of one), asked about once. */
export type UnmatchedCategory = {
  /** "<type>|<lowercased name>" -- the key a choice is stored under. */
  key: string;
  type: ImportType;
  /** The name as the file wrote it; null when the file gave none. */
  name: string | null;
  count: number;
  rows: number[];
};

export type CategoryMatch = {
  /** row number -> category id: matched by name, or put there by the person. */
  byRow: Map<number, string>;
  /** Every group that didn't match by name, with its count. */
  unmatched: UnmatchedCategory[];
  /** The groups still without a category chosen -- the import waits on these. */
  unresolved: UnmatchedCategory[];
};

const nameKey = (s: string) => s.trim().toLowerCase();
export const categoryGroupKey = (type: ImportType, name: string | null) => `${type}|${name === null ? "" : nameKey(name)}`;

/**
 * By name, ignoring case, among the person's active categories of the
 * row's own type (a transaction's type must match its category's -- the
 * database says so too). Names aren't unique in Sorrel, so a name that
 * matches two categories is NOT matched: it is asked about like any other,
 * never guessed between. No category is ever created here.
 *
 * The database requires a category on every transaction
 * (transactions_category_required), so a row that matched nothing can't
 * come in uncategorised: each group of unmatched rows needs a category the
 * person chooses (`chosen`, by group key). Until they do, the group is
 * `unresolved` and the import doesn't proceed.
 */
export function matchCategories(
  rows: readonly { row: number; type: ImportType; categoryName: string | null }[],
  categories: readonly CategoryOption[],
  chosen: ReadonlyMap<string, string> = new Map(),
): CategoryMatch {
  const index = new Map<string, string[]>();
  for (const c of categories) {
    const key = categoryGroupKey(c.type, c.name);
    const list = index.get(key);
    if (list) list.push(c.id);
    else index.set(key, [c.id]);
  }

  const byRow = new Map<number, string>();
  const groups = new Map<string, UnmatchedCategory>();
  for (const r of rows) {
    const named = r.categoryName !== null && r.categoryName.trim() !== "";
    const key = categoryGroupKey(r.type, named ? r.categoryName : null);
    const ids = named ? index.get(key) : undefined;
    if (ids && ids.length === 1) {
      byRow.set(r.row, ids[0]);
      continue;
    }
    const seen = groups.get(key);
    if (seen) {
      seen.count++;
      seen.rows.push(r.row);
    } else {
      groups.set(key, { key, type: r.type, name: named ? r.categoryName!.trim() : null, count: 1, rows: [r.row] });
    }
  }

  const unmatched = [...groups.values()].sort(
    (a, b) =>
      b.count - a.count ||
      Number(a.name === null) - Number(b.name === null) || // a named group before "no category given"
      (a.name ?? "").localeCompare(b.name ?? "") ||
      a.type.localeCompare(b.type),
  );
  const unresolved: UnmatchedCategory[] = [];
  for (const g of unmatched) {
    const id = chosen.get(g.key);
    if (id === undefined) unresolved.push(g);
    else for (const row of g.rows) byRow.set(row, id);
  }
  return { byRow, unmatched, unresolved };
}

// ---------------------------------------------------------------------
// The preview's figures (step 6)
// ---------------------------------------------------------------------

/** One date, as import_preview() returned it. */
export type DateTreatment = {
  treatment: "counts" | "before_anchor" | "future";
  countsIfIncluded: boolean;
  countsIfAdded: boolean;
};

/** The batch's one pre-anchor answer: null until the person gives it. */
export type PreAnchorChoice = "included" | "added" | null;

export type ImportSummary = {
  count: number;
  spentCount: number;
  spentCents: number;
  receivedCount: number;
  receivedCents: number;
  /** Rows the person made transfers: neither spent nor received (migration 76). */
  transferCount: number;
  /** Rows dated before the account's balance date -- the question's subject. */
  beforeAnchorCount: number;
  /** Rows dated after today: they count on their dates. */
  futureCount: number;
  /** Rows that move the balance now, under the current answer. */
  countedCount: number;
  /** What the balance changes by: income minus spending, counted rows only. */
  balanceChangeCents: number;
  /** A row needs the answer and there isn't one yet. */
  answerNeeded: boolean;
  /** Rows whose date the database hasn't described -- never counted. */
  undescribed: number;
};

/**
 * Adds up the rows that will be written. Integer cents throughout; the
 * only thing decided here is which of the database's two answers to read.
 */
export function summarizeImport(
  rows: readonly { date: string; cents: number; type: ImportType; transfer?: boolean }[],
  treatments: ReadonlyMap<string, DateTreatment>,
  answer: PreAnchorChoice,
): ImportSummary {
  const s: ImportSummary = {
    count: 0,
    spentCount: 0,
    spentCents: 0,
    receivedCount: 0,
    receivedCents: 0,
    transferCount: 0,
    beforeAnchorCount: 0,
    futureCount: 0,
    countedCount: 0,
    balanceChangeCents: 0,
    answerNeeded: false,
    undescribed: 0,
  };

  for (const r of rows) {
    s.count++;
    if (r.transfer) {
      s.transferCount++;
    } else if (r.type === "Expense") {
      s.spentCount++;
      s.spentCents += r.cents;
    } else {
      s.receivedCount++;
      s.receivedCents += r.cents;
    }

    const t = treatments.get(r.date);
    if (!t) {
      s.undescribed++;
      continue;
    }
    if (t.treatment === "future") s.futureCount++;

    let counted: boolean;
    if (t.treatment === "before_anchor") {
      s.beforeAnchorCount++;
      if (answer === null) {
        s.answerNeeded = true;
        counted = false;
      } else {
        counted = answer === "added" ? t.countsIfAdded : t.countsIfIncluded;
      }
    } else {
      counted = t.countsIfIncluded;
    }
    if (counted) {
      s.countedCount++;
      s.balanceChangeCents += r.type === "Income" ? r.cents : -r.cents;
    }
  }
  return s;
}

/** The answer as import_transactions() takes it: true = "No, add them to my balance". */
export function choiceToCountsDespiteAnchor(choice: PreAnchorChoice): boolean | null {
  return choice === null ? null : choice === "added";
}
