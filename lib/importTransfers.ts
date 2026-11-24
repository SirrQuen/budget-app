// Transfers and categories in the import preview -- pure, so every rule is
// tested without a browser or a database (lib/importTransfers.test.ts).
// docs/Import-CSV.md, "Transfers" and "Categories per row" (migration 76).
//
// Everything here runs ON THE DEVICE. The file's descriptions and amounts
// stay in the browser until the person presses Import; what the server
// sent beforehand is the person's own data -- recent rows on their other
// accounts, and a capped map of how they've categorised descriptions --
// and the matching against the file happens here.
//
// Nothing here decides for the person. A row that "looks like a transfer"
// is flagged; a matching entry on another account is asked about; a
// suggested category is shown as suggested and can be changed.

import { daysBetweenInclusive } from "@/lib/date";
import type { ImportType } from "@/lib/importCsv";

// ---------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------

/**
 * Days either side a matching entry on another account may sit: one bank
 * posts Friday, the other the following Wednesday (ruling 2026-11-20).
 */
export const TRANSFER_MATCH_DAYS = 5;

/**
 * The words banks use for money moving between your own accounts, card
 * payments included ("CAPITAL ONE MOBILE PMT", "CHASE CREDIT CRD EPAY",
 * "DISCOVER E-PAYMENT"; widened 2026-11-24).
 */
const TRANSFER_WORDS =
  /\b(?:TRANSFER|TRNSFR|XFER|XFR|TFR|PMT|PAYMENT\s*-?\s*THANK\s+YOU|THANK\s+YOU\s+FOR\s+YOUR\s+PAYMENT|PAYMENT\s+(?:TO|FROM)|AUTO\s*PAY|AUTOPAY|CREDIT\s+CARD\s+PAYMENT|CARD\s+PAYMENT|CRD\s+EPAY|E-?PAYMENT)\b/i;

/**
 * Person-to-person apps. Money sent through them usually goes to someone
 * else, so their wording never flags a row on its own ("ZELLE PAYMENT TO
 * SAM", "VENMO TRANSFER"). A matching entry on another account still does.
 */
const PERSON_TO_PERSON = /\b(?:ZELLE|VENMO|CASH\s*APP)\b/i;

/** Whether the description reads like a transfer. A hint, never a decision. */
export function transferWording(description: string): boolean {
  return TRANSFER_WORDS.test(description) && !PERSON_TO_PERSON.test(description);
}

/**
 * A row that looks like a transfer -- by its wording, or a matching entry
 * on another account -- waits for the person to say what it is: a
 * transfer, or spending (income) after all. Neither is assumed, and until
 * it's answered it takes no category, suggested or from the file (ruled
 * 2026-11-24: a category learned from transfers once imported as spending
 * would otherwise settle the question for them). A Sorrel export's
 * transfer leg already is one and is never asked; neither is a row left
 * out of the import.
 */
export function awaitsTransferAnswer(r: {
  included: boolean;
  looksLikeTransfer: boolean;
  /** The file says it's a transfer (a Sorrel export's leg). */
  fileTransfer: boolean;
  /** Whether the person has set the row's type themselves. */
  answered: boolean;
}): boolean {
  return r.included && r.looksLikeTransfer && !r.fileTransfer && !r.answered;
}

/** The import's to-do for unanswered rows: "say whether 2 rows that look like transfers are transfers". */
export function transferAnswerTodo(count: number): string {
  return count === 1
    ? "say whether 1 row that looks like a transfer is a transfer"
    : `say whether ${count} rows that look like transfers are transfers`;
}

/**
 * The line above Import once flagged rows are kept as spending or income:
 * a fact, so a one-sided transfer is never a surprise. Null when none are.
 */
export function keptTransfersSentence(spending: number, income: number): string | null {
  if (spending + income === 0) return null;
  const lead = (n: number) => (n === 1 ? "1 row that looks like a transfer" : `${n} rows that look like transfers`);
  if (income === 0) return `${lead(spending)} will come in as spending.`;
  if (spending === 0) return `${lead(income)} will come in as income.`;
  return `${lead(spending + income)} will come in as spending (${spending}) or income (${income}).`;
}

/** An entry already on one of the person's OTHER active accounts (not a transfer leg). */
export type TransferCandidate = {
  id: string;
  accountId: string;
  date: string;
  cents: number;
  type: ImportType;
  description: string;
  /**
   * Whether it can become the other leg: no schedule, no same-bill answer,
   * and no goal if it would be the Income leg (migration 76's rule; the
   * server checks it again).
   */
  pairable: boolean;
};

export type TransferMatchRow = {
  row: number;
  type: ImportType;
  date: string;
  cents: number;
  /** The account the person chose for a Transfer row; null looks on every other account. */
  otherAccountId: string | null;
};

export type TransferMatch = { candidate: TransferCandidate; gapDays: number };

const gap = (a: string, b: string) => Math.abs(daysBetweenInclusive(a, b) - 1);

/**
 * The other side of a transfer: an entry on another account in the
 * OPPOSITE direction, for the exact amount, within TRANSFER_MATCH_DAYS.
 * One entry per row and one row per entry, closest first, then the
 * earlier file row, then the id -- so two $500 transfers in a file find
 * two different entries, never the same one twice.
 */
export function findTransferMatches(
  rows: readonly TransferMatchRow[],
  candidates: readonly TransferCandidate[],
): Map<number, TransferMatch> {
  const byCents = new Map<number, TransferCandidate[]>();
  for (const c of candidates) {
    const list = byCents.get(c.cents);
    if (list) list.push(c);
    else byCents.set(c.cents, [c]);
  }

  const pairs: { row: TransferMatchRow; c: TransferCandidate; g: number }[] = [];
  for (const r of rows) {
    for (const c of byCents.get(r.cents) ?? []) {
      if (c.type === r.type) continue;
      if (r.otherAccountId !== null && c.accountId !== r.otherAccountId) continue;
      const g = gap(r.date, c.date);
      if (g > TRANSFER_MATCH_DAYS) continue;
      pairs.push({ row: r, c, g });
    }
  }
  pairs.sort((x, y) => x.g - y.g || x.row.row - y.row.row || (x.c.id < y.c.id ? -1 : x.c.id > y.c.id ? 1 : 0));

  const usedRows = new Set<number>();
  const usedCandidates = new Set<string>();
  const found = new Map<number, TransferMatch>();
  for (const p of pairs) {
    if (usedRows.has(p.row.row) || usedCandidates.has(p.c.id)) continue;
    usedRows.add(p.row.row);
    usedCandidates.add(p.c.id);
    found.set(p.row.row, { candidate: p.c, gapDays: p.g });
  }
  return found;
}

/**
 * The rows the same-bill question applies to, as findImportSameBill takes
 * them -- built here so the browser and the server's re-check agree. A
 * transfer that creates both legs carries its other account (a transfer
 * schedule matches on both ends); a row JOINED to an existing entry is
 * left out, since it can't take an occurrence in v1 (ruling 2026-11-20).
 */
export function sameBillRows(
  rows: readonly {
    row: number;
    type: ImportType;
    date: string;
    cents: number;
    transfer: { otherAccountId: string; pairWith: string | null } | null;
  }[],
): { row: number; type: ImportType; date: string; cents: number; transferOtherAccountId: string | null }[] {
  return rows
    .filter((r) => r.transfer === null || r.transfer.pairWith === null)
    .map((r) => ({
      row: r.row,
      type: r.type,
      date: r.date,
      cents: r.cents,
      transferOtherAccountId: r.transfer?.otherAccountId ?? null,
    }));
}

// ---------------------------------------------------------------------
// Categories: the description -> category history
// ---------------------------------------------------------------------

/** Words that say how a card was used, not who was paid. */
const NOISE = new Set([
  "POS", "DEBIT", "CREDIT", "CARD", "PURCHASE", "CHECKCARD", "VISA", "MASTERCARD", "MC", "SQ", "TST",
  "ACH", "RECURRING", "ONLINE", "WWW", "COM", "THE", "PENDING", "PREAUTHORIZED", "PMT", "WITHDRAWAL",
]);

/**
 * A description's merchant, as far as text can tell: upper case, without
 * punctuation, store numbers, dates, card digits and the words above, then
 * the first two words that remain. "SQ *BLUE BOTTLE 0423 OAKLAND" and
 * "BLUE BOTTLE #19" are both "BLUE BOTTLE". Null when nothing is left.
 */
export function merchantKey(description: string): string | null {
  const words = description
    .toUpperCase()
    .replace(/[^A-Z0-9&' ]+/g, " ")
    .replace(/'/g, "")
    .split(/\s+/)
    .filter((w) => w !== "" && !/\d/.test(w) && !NOISE.has(w) && w.length > 1);
  if (words.length === 0) return null;
  return words.slice(0, 2).join(" ");
}

/** At most this many merchants go to the browser. */
export const MAX_HISTORY_KEYS = 2000;

/** One merchant's usual category, per type: what the browser receives. */
export type CategoryHistoryEntry = { key: string; type: ImportType; categoryId: string };

/**
 * From the person's own categorised rows: each merchant's most-used
 * category for each type (ties: the more recently used, then the id), the
 * MAX_HISTORY_KEYS most-used merchants. Only categories still active count.
 * Rows come newest first.
 */
export function buildCategoryHistory(
  rows: readonly { description: string; categoryId: string; type: ImportType }[],
  activeCategoryIds: ReadonlySet<string>,
): CategoryHistoryEntry[] {
  type Tally = { count: number; firstSeen: number };
  const byKey = new Map<string, { total: number; cats: Map<string, Tally>; key: string; type: ImportType }>();
  rows.forEach((r, i) => {
    if (!activeCategoryIds.has(r.categoryId)) return;
    const key = merchantKey(r.description);
    if (key === null) return;
    const k = `${r.type}|${key}`;
    let e = byKey.get(k);
    if (!e) {
      e = { total: 0, cats: new Map(), key, type: r.type };
      byKey.set(k, e);
    }
    e.total++;
    const t = e.cats.get(r.categoryId);
    if (t) t.count++;
    else e.cats.set(r.categoryId, { count: 1, firstSeen: i });
  });

  const entries = [...byKey.values()]
    .sort((a, b) => b.total - a.total || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) || a.type.localeCompare(b.type))
    .slice(0, MAX_HISTORY_KEYS);
  return entries.map((e) => {
    const [categoryId] = [...e.cats.entries()].sort(
      (a, b) => b[1].count - a[1].count || a[1].firstSeen - b[1].firstSeen || (a[0] < b[0] ? -1 : 1),
    )[0];
    return { key: e.key, type: e.type, categoryId };
  });
}

/** Looks a description up in the history: the category to suggest, if any. */
export function suggestCategory(
  history: ReadonlyMap<string, string>,
  description: string,
  type: ImportType,
): string | undefined {
  const key = merchantKey(description);
  return key === null ? undefined : history.get(`${type}|${key}`);
}

export const historyMap = (entries: readonly CategoryHistoryEntry[]) =>
  new Map(entries.map((e) => [`${e.type}|${e.key}`, e.categoryId]));

// ---------------------------------------------------------------------
// Categories: one per row
// ---------------------------------------------------------------------

/** Where a row's category came from -- so the preview can say "suggested". */
export type CategorySource = "chosen" | "file" | "suggested";

export type RowCategory = { id: string; source: CategorySource };

/**
 * Each non-transfer row's category: the person's own choice, else the
 * file's category name when it matches exactly one of theirs, else the
 * history's suggestion -- always one of the row's own type (the database
 * refuses anything else). A row with none is listed in `missing`, and the
 * import waits on it. A transfer row has no category and is never listed;
 * nor is a row still waiting to be answered transfer-or-not
 * (awaitsTransferAnswer) -- that question comes first, and the import
 * waits on it instead.
 */
export function resolveRowCategories(
  rows: readonly {
    row: number;
    type: ImportType;
    transfer: boolean;
    description: string;
    fileCategoryId: string | null;
    awaitingTransferAnswer?: boolean;
  }[],
  categoryTypes: ReadonlyMap<string, ImportType>,
  chosen: ReadonlyMap<number, string>,
  history: ReadonlyMap<string, string>,
): { byRow: Map<number, RowCategory>; missing: number[] } {
  const byRow = new Map<number, RowCategory>();
  const missing: number[] = [];
  const fits = (id: string | null | undefined, type: ImportType): id is string =>
    id != null && categoryTypes.get(id) === type;
  for (const r of rows) {
    if (r.transfer || r.awaitingTransferAnswer) continue;
    const pick = chosen.get(r.row);
    const suggested = suggestCategory(history, r.description, r.type);
    if (fits(pick, r.type)) byRow.set(r.row, { id: pick, source: "chosen" });
    else if (fits(r.fileCategoryId, r.type)) byRow.set(r.row, { id: r.fileCategoryId, source: "file" });
    else if (fits(suggested, r.type)) byRow.set(r.row, { id: suggested, source: "suggested" });
    else missing.push(r.row);
  }
  return { byRow, missing };
}

/**
 * "Apply <Category> to N other <MERCHANT> rows?": the other non-transfer
 * rows of the same type and merchant whose category isn't that one yet.
 */
export function sameMerchantRows(
  picked: { row: number; type: ImportType; description: string; categoryId: string },
  rows: readonly { row: number; type: ImportType; transfer: boolean; description: string }[],
  current: ReadonlyMap<number, RowCategory>,
): { merchant: string; rows: number[] } | null {
  const key = merchantKey(picked.description);
  if (key === null) return null;
  const others = rows
    .filter(
      (r) =>
        r.row !== picked.row &&
        !r.transfer &&
        r.type === picked.type &&
        merchantKey(r.description) === key &&
        current.get(r.row)?.id !== picked.categoryId,
    )
    .map((r) => r.row);
  return others.length === 0 ? null : { merchant: key, rows: others };
}
