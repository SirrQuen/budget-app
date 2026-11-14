import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildListHref,
  buildSearchOr,
  escapeLike,
  hasActiveFilters,
  MAX_SEARCH_LENGTH,
  monthRange,
  parsePage,
  parseSearchAmount,
  parseTransactionFilters,
} from "./transactionFilters";

const ID = "3f2c1b9a-0d4e-4c7a-9b1e-5a6d7c8e9f00";

test("parse: valid values pass, junk is dropped", () => {
  const f = parseTransactionFilters({
    dateFrom: "2026-11-01",
    dateTo: "not-a-date",
    categoryid: ID,
    accountid: "'; drop table",
    type: "Income",
    q: "  rent  ",
  });
  assert.deepEqual(f, {
    dateFrom: "2026-11-01",
    dateTo: "",
    categoryid: ID,
    accountid: "",
    type: "Income",
    q: "rent",
  });
});

test("parse: an unknown type is no type; a repeated param is ignored", () => {
  assert.equal(parseTransactionFilters({ type: "Transfer" }).type, "");
  assert.equal(parseTransactionFilters({ q: ["a", "b"] }).q, "");
});

test("parse: search text is capped", () => {
  assert.equal(parseTransactionFilters({ q: "x".repeat(500) }).q.length, MAX_SEARCH_LENGTH);
});

test("page: 1 unless a real page past the first", () => {
  assert.equal(parsePage({}), 1);
  assert.equal(parsePage({ page: "0" }), 1);
  assert.equal(parsePage({ page: "abc" }), 1);
  assert.equal(parsePage({ page: "3.9" }), 3);
});

test("hasActiveFilters: the locked account is the page, not a filter", () => {
  const none = parseTransactionFilters({});
  assert.equal(hasActiveFilters(none), false);
  assert.equal(hasActiveFilters({ ...none, accountid: ID }), true);
  assert.equal(hasActiveFilters({ ...none, accountid: ID }, ID), false);
  assert.equal(hasActiveFilters({ ...none, q: "rent" }, ID), true);
});

test("href: empty values are left out and a changed filter drops the page", () => {
  const f = parseTransactionFilters({ q: "rent", type: "Expense", page: "4" });
  assert.equal(buildListHref("/transactions", f), "/transactions?type=Expense&q=rent");
  assert.equal(buildListHref("/transactions", f, { page: "2" }), "/transactions?type=Expense&q=rent&page=2");
  assert.equal(buildListHref(`/accounts/${ID}`, {}), `/accounts/${ID}`);
  assert.equal(buildListHref("/transactions", f, { q: "" }), "/transactions?type=Expense");
});

test("href: text is encoded", () => {
  assert.equal(buildListHref("/transactions", { q: "a&b=c" }), "/transactions?q=a%26b%3Dc");
});

test("monthRange: whole calendar month, leap February included", () => {
  assert.deepEqual(monthRange("2026-11-01"), { dateFrom: "2026-11-01", dateTo: "2026-11-30" });
  assert.deepEqual(monthRange("2028-02-01"), { dateFrom: "2028-02-01", dateTo: "2028-02-29" });
  assert.deepEqual(monthRange("2026-12-01"), { dateFrom: "2026-12-01", dateTo: "2026-12-31" });
});

test("amount: dollar-shaped terms become exact decimal strings", () => {
  assert.equal(parseSearchAmount("45"), "45");
  assert.equal(parseSearchAmount("$1,850.00"), "1850.00");
  assert.equal(parseSearchAmount("12.5"), "12.5");
  assert.equal(parseSearchAmount("1,85"), null);
  assert.equal(parseSearchAmount("rent"), null);
  assert.equal(parseSearchAmount("12.345"), null);
  assert.equal(parseSearchAmount("-5"), null);
});

test("like: wildcards and backslashes search for what was typed", () => {
  assert.equal(escapeLike("50%_off\\"), "50\\%\\_off\\\\");
});

test("search: description and notes always; an amount only when it is one", () => {
  assert.equal(buildSearchOr("rent", [], []), 'description.ilike."%rent%",notes.ilike."%rent%"');
  assert.equal(
    buildSearchOr("45", [], []),
    'description.ilike."%45%",notes.ilike."%45%",amount.eq.45',
  );
});

test("search: matched category and account names bring their ids", () => {
  assert.equal(
    buildSearchOr("visa", ["c1"], ["a1", "a2"]),
    'description.ilike."%visa%",notes.ilike."%visa%",categoryid.in.(c1),accountid.in.(a1,a2)',
  );
});

test("search: commas, parens and quotes can't change the filter's shape", () => {
  const or = buildSearchOr('a,b),amount.gt.0 "x"', [], []);
  // One quoted value per column: the quote and backslash are escaped, and the
  // comma and paren stay inside the quotes.
  assert.equal(
    or,
    'description.ilike."%a,b),amount.gt.0 \\"x\\"%",notes.ilike."%a,b),amount.gt.0 \\"x\\"%"',
  );
});

test("search: a literal % is escaped through both layers", () => {
  // LIKE wants \%, and PostgREST's quoting wants that backslash doubled.
  assert.equal(buildSearchOr("50%", [], []), 'description.ilike."%50\\\\%%",notes.ilike."%50\\\\%%"');
});
