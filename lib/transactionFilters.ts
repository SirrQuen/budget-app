// The one filter model for the transaction list. /transactions and
// /accounts/[id] are the same list with different starting filters, so the
// URL <-> filters mapping lives here and nowhere else: account, category,
// type, date range, text -- and the two scopes other screens open the list
// with (a budget's drill-down, the dashboard's Income and Spending tiles).
// Pure -- no database, no React.

import { addDaysISO, endOfMonthISO } from "@/lib/date";
import type { DashboardRange } from "@/lib/dashboardRange";
import { formatMonthName } from "@/lib/budgetMonth";
import { formatDayMonthShort } from "@/lib/format";

export type SearchParams = Record<string, string | string[] | undefined>;

export type TransactionFilters = {
  dateFrom: string;
  dateTo: string;
  categoryid: string;
  accountid: string;
  type: "" | "Income" | "Expense";
  /** Free text: description, notes, category, account, or an exact amount. */
  q: string;
  /** A dashboard tile's drill-down: its scope (flowScope), with `period`. */
  flow: "" | Flow;
  /** "YYYY-MM", or "YYYY-MM-DD..YYYY-MM-DD" for the dashboard's other ranges. Set only with `flow`. */
  period: string;
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
  // Together or not at all: a flow with no period has no total to show.
  const flowParam = params.flow === "income" || params.flow === "spending" ? params.flow : "";
  const periodParam = first(params.period);
  const flow = flowParam && isPeriod(periodParam) ? flowParam : "";
  return {
    dateFrom: ISO_DATE.test(dateFrom) ? dateFrom : "",
    dateTo: ISO_DATE.test(dateTo) ? dateTo : "",
    categoryid: UUID.test(categoryid) ? categoryid : "",
    accountid: UUID.test(accountid) ? accountid : "",
    // A flow fixes the direction itself.
    type: !flow && (params.type === "Income" || params.type === "Expense") ? params.type : "",
    q: first(params.q).trim().slice(0, MAX_SEARCH_LENGTH),
    flow,
    period: flow ? periodParam : "",
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
      f.flow ||
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
  for (const key of ["flow", "period", "dateFrom", "dateTo", "categoryid", "accountid", "type", "q", "page"]) {
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

// ---- Budget drill-down ----------------------------------------------------

/**
 * The month a filter set is a budget's drill-down for, or null. A budget's
 * "spent" is one category's Expense rows, no transfer legs, in one calendar
 * month (budget_progress_for_month). The list is that drill-down only while
 * its filters are exactly those -- category, Expense, the whole month, and
 * nothing else (no search, no account) -- so the budget's figure can head
 * it and be true of every row beneath. Any other filter and it's just a
 * list. The one place that decision is made.
 */
export function budgetDrillMonth(f: TransactionFilters): string | null {
  if (!f.categoryid || f.type !== "Expense" || f.q || f.accountid || f.flow) return null;
  if (!f.dateFrom || !f.dateFrom.endsWith("-01")) return null;
  const range = monthRange(f.dateFrom);
  return range.dateTo === f.dateTo ? f.dateFrom : null;
}

/** The drill-down link a budget's name and spent figure open. */
export function budgetDrillHref(categoryid: string, month: string): string {
  return buildListHref("/transactions", { categoryid, type: "Expense", ...monthRange(month) });
}

// ---- Income and spending (the dashboard tiles) ---------------------------

export type Flow = "income" | "spending";

/**
 * What one tile counts: one direction, no transfer legs, dated inside the
 * span. Nothing else narrows it -- goal-linked rows, imported rows, archived
 * accounts and categories all count; a schedule not yet confirmed has no row.
 *
 * THE one definition: the tile sums it (lib/rangeCashflow.ts) and the
 * drill-down lists it (listReadOptions). The tile's sum is made by SQL, in
 * v_daily_cashflow, so `column` and inFlowScope() are its TypeScript twin:
 * docs/flow-scope-test.sql checks they agree (`npm run test:parity:flow`).
 * Never restate any of this elsewhere.
 */
export type FlowScope = {
  flow: Flow;
  type: "Income" | "Expense";
  /** The v_daily_cashflow column that holds this scope's days. */
  column: "income" | "expenses";
  /** Inclusive. An empty span (from after to) selects nothing. */
  dateFrom: string;
  dateTo: string;
};

export function flowScope(flow: Flow, span: { from: string; to: string }): FlowScope {
  return {
    flow,
    type: flow === "income" ? "Income" : "Expense",
    column: flow === "income" ? "income" : "expenses",
    dateFrom: span.from,
    dateTo: span.to,
  };
}

/** Whether a row is in a scope -- v_daily_cashflow's filters, in TypeScript. */
export function inFlowScope(
  row: { transaction_type: string; transaction_date: string; transfer_group_id: string | null },
  scope: FlowScope,
): boolean {
  return (
    row.transfer_group_id === null &&
    row.transaction_type === scope.type &&
    row.transaction_date >= scope.dateFrom &&
    row.transaction_date <= scope.dateTo
  );
}

const MONTH_PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const RANGE_PERIOD = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

/** A real calendar day, not just the shape of one. */
function isRealDay(iso: string): boolean {
  return addDaysISO(iso, 0) === iso;
}

function isPeriod(value: string): boolean {
  if (MONTH_PERIOD.test(value)) return true;
  const m = RANGE_PERIOD.exec(value);
  return m !== null && isRealDay(m[1]) && isRealDay(m[2]) && m[1] <= m[2];
}

/**
 * The days a period covers, seen from `today` (the user's day). A month runs
 * to its end, or to today while it is still going -- the tile's month to
 * date. So a link opened next month still shows the whole of its month.
 */
export function periodSpan(period: string, today: string): { from: string; to: string } {
  const range = RANGE_PERIOD.exec(period);
  if (range) return { from: range[1], to: range[2] };
  const from = `${period}-01`;
  const end = endOfMonthISO(from);
  return { from, to: today < end ? today : end };
}

/** The period a dashboard range's tiles carry into their links. */
export function periodForRange(range: Pick<DashboardRange, "preset" | "from" | "to">): string {
  return range.preset === "mtd" ? range.from.slice(0, 7) : `${range.from}..${range.to}`;
}

/** The scope a filter set is drilling into, or null for an ordinary list. */
export function activeFlowScope(f: Pick<TransactionFilters, "flow" | "period">, today: string): FlowScope | null {
  return f.flow && f.period ? flowScope(f.flow, periodSpan(f.period, today)) : null;
}

/** The link a tile opens. */
export function flowDrillHref(flow: Flow, period: string): string {
  return buildListHref("/transactions", { flow, period });
}

/**
 * What the list, its export and its summary read for a filter set. With a
 * flow, the other filters only ever narrow its scope.
 */
export function listReadOptions(filters: Partial<TransactionFilters>, today: string) {
  const scope = activeFlowScope({ flow: filters.flow ?? "", period: filters.period ?? "" }, today);
  let { dateFrom, dateTo } = filters;
  if (scope) {
    if (!dateFrom || dateFrom < scope.dateFrom) dateFrom = scope.dateFrom;
    if (!dateTo || dateTo > scope.dateTo) dateTo = scope.dateTo;
  }
  const type = scope ? scope.type : filters.type;
  return {
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    ...(filters.categoryid ? { categoryid: filters.categoryid } : {}),
    ...(filters.accountid ? { accountid: filters.accountid } : {}),
    ...(type ? { transaction_type: type } : {}),
    ...(scope ? { excludeTransfers: true } : {}),
    ...(filters.q ? { q: filters.q } : {}),
  };
}

/** Whether anything is narrowing a flow drill-down further. */
export function narrowsFlow(f: TransactionFilters): boolean {
  return Boolean(f.categoryid || f.accountid || f.q || f.dateFrom || f.dateTo);
}

/**
 * How a period reads: `short` for the chip ("November", "27 Oct – 25 Nov"),
 * `phrase` inside a sentence ("in November", "from 27 Oct to 25 Nov"). The
 * year is named only when it isn't this one.
 */
export function periodLabels(period: string, today: string): { short: string; phrase: string } {
  if (MONTH_PERIOD.test(period)) {
    const month = formatMonthName(`${period}-01`, today);
    return { short: month, phrase: `in ${month}` };
  }
  const { from, to } = periodSpan(period, today);
  const day = (iso: string) =>
    iso.slice(0, 4) === today.slice(0, 4)
      ? formatDayMonthShort(iso)
      : `${formatDayMonthShort(iso)} ${iso.slice(0, 4)}`;
  if (from === to) return { short: day(from), phrase: `on ${day(from)}` };
  return { short: `${day(from)} – ${day(to)}`, phrase: `from ${day(from)} to ${day(to)}` };
}

/**
 * Where a category in the summary leads: this same drill-down -- flow and
 * period -- narrowed to the category, so what it lists adds up to the row
 * (ruled 2026-11-25; not the budget drill-down, which counts a whole month).
 * Any other narrowing is dropped: the row's figure is the whole scope's.
 */
export function flowCategoryHref(categoryid: string, flow: Flow, period: string): string {
  return buildListHref("/transactions", { flow, period, categoryid });
}
