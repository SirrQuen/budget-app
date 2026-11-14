// The one filter model for the transaction list. /transactions and
// /accounts/[id] are the same list with different starting filters, so the
// URL <-> filters mapping lives here and nowhere else: account, category,
// type, date range, text. Pure -- no database, no React.

export type SearchParams = Record<string, string | string[] | undefined>;

export type TransactionFilters = {
  dateFrom: string;
  dateTo: string;
  categoryid: string;
  accountid: string;
  type: "" | "Income" | "Expense";
  /** Free text: description, notes, category, account, or an exact amount. */
  q: string;
};

/** Search text is capped so a pasted wall of text can't build a huge query. */
export const MAX_SEARCH_LENGTH = 100;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export function parseTransactionFilters(params: SearchParams): TransactionFilters {
  const dateFrom = first(params.dateFrom);
  const dateTo = first(params.dateTo);
  const categoryid = first(params.categoryid);
  const accountid = first(params.accountid);
  return {
    dateFrom: ISO_DATE.test(dateFrom) ? dateFrom : "",
    dateTo: ISO_DATE.test(dateTo) ? dateTo : "",
    categoryid: UUID.test(categoryid) ? categoryid : "",
    accountid: UUID.test(accountid) ? accountid : "",
    type: params.type === "Income" || params.type === "Expense" ? params.type : "",
    q: first(params.q).trim().slice(0, MAX_SEARCH_LENGTH),
  };
}

export function parsePage(params: SearchParams): number {
  const raw = Number(first(params.page));
  return Number.isFinite(raw) && raw > 1 ? Math.floor(raw) : 1;
}

/**
 * Filters the person chose. `lockedAccountId` is the account an account page
 * is already about: it's part of the page, not a filter to clear.
 */
export function hasActiveFilters(f: TransactionFilters, lockedAccountId?: string): boolean {
  return Boolean(
    f.dateFrom ||
      f.dateTo ||
      f.categoryid ||
      f.type ||
      f.q ||
      (f.accountid && f.accountid !== lockedAccountId),
  );
}

/**
 * The list's URL for these filters on `basePath` -- every filtered,
 * paginated view is a link, and this is the only place a query string is
 * assembled. Empty values are left out. `overrides` replaces filters (and
 * `page`); the page is dropped unless asked for, since a changed filter
 * starts over.
 */
export function buildListHref(
  basePath: string,
  filters: Partial<TransactionFilters>,
  overrides: Partial<TransactionFilters> & { page?: string } = {},
): string {
  const merged: Record<string, string> = { ...filters, ...overrides };
  const usp = new URLSearchParams();
  for (const key of ["dateFrom", "dateTo", "categoryid", "accountid", "type", "q", "page"]) {
    const value = merged[key];
    if (value) usp.set(key, value);
  }
  const qs = usp.toString();
  return `${basePath}${qs ? `?${qs}` : ""}`;
}

/** First day, last day of a "YYYY-MM-01" month, as ISO dates. */
export function monthRange(monthStart: string): { dateFrom: string; dateTo: string } {
  const [y, m] = monthStart.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { dateFrom: `${y}-${mm}-01`, dateTo: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

// ---- Search -------------------------------------------------------------

/** A search term that is a dollar amount ("45", "$1,850.00", "12.5"), as a
 * plain decimal string -- never a float, never rounded. null otherwise. */
export function parseSearchAmount(q: string): string | null {
  const m = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?$/.exec(q.trim());
  if (!m) return null;
  return `${m[1].replace(/,/g, "")}${m[2] ?? ""}`;
}

/** Escapes LIKE wildcards so "50%" and "a_b" search for what was typed. */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The PostgREST `or=` filter for a text search over the transactions table:
 * description, notes, an exact amount, and the ids of any categories or
 * accounts whose NAME matched (the caller looks those up -- the names live
 * in other tables). Values are double-quoted so commas, parentheses and dots
 * in the person's text can't change the filter's shape.
 */
export function buildSearchOr(
  q: string,
  matchedCategoryIds: readonly string[],
  matchedAccountIds: readonly string[],
): string {
  const quoted = `"%${escapeLike(q).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}%"`;
  const parts = [`description.ilike.${quoted}`, `notes.ilike.${quoted}`];
  const amount = parseSearchAmount(q);
  if (amount !== null) parts.push(`amount.eq.${amount}`);
  if (matchedCategoryIds.length > 0) parts.push(`categoryid.in.(${matchedCategoryIds.join(",")})`);
  if (matchedAccountIds.length > 0) parts.push(`accountid.in.(${matchedAccountIds.join(",")})`);
  return parts.join(",");
}
