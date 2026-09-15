import { test } from "node:test";
import assert from "node:assert/strict";
import { isBusinessDay, addBusinessDays, resolveDueDate } from "./businessDays";

const NO_HOLIDAYS: ReadonlySet<string> = new Set();

test("isBusinessDay: plain weekday/weekend, no holidays", () => {
  assert.equal(isBusinessDay("2026-09-18", NO_HOLIDAYS), true); // Friday
  assert.equal(isBusinessDay("2026-09-19", NO_HOLIDAYS), false); // Saturday
  assert.equal(isBusinessDay("2026-09-20", NO_HOLIDAYS), false); // Sunday
});

test("isBusinessDay: a weekday can still be a holiday", () => {
  const holidays = new Set(["2026-11-26"]); // Thanksgiving, a Thursday
  assert.equal(isBusinessDay("2026-11-26", holidays), false);
  assert.equal(isBusinessDay("2026-11-25", holidays), true);
});

test("addBusinessDays: n=0 is the identity", () => {
  assert.equal(addBusinessDays("2026-09-18", 0, NO_HOLIDAYS), "2026-09-18");
});

test("addBusinessDays: negative n is a caller error", () => {
  assert.throws(() => addBusinessDays("2026-09-18", -1, NO_HOLIDAYS));
});

// Required scenario 1: a Friday anchor crossing a weekend.
test("addBusinessDays: Friday + 1 business day skips the weekend to Monday", () => {
  assert.equal(addBusinessDays("2026-09-18", 1, NO_HOLIDAYS), "2026-09-21");
});

test("resolveDueDate: offset=0 on a Saturday, rule='after' shifts to the following Monday", () => {
  assert.equal(resolveDueDate("2026-09-19", 0, "after", NO_HOLIDAYS), "2026-09-21");
});

test("resolveDueDate: offset=0 on a Saturday, rule='before' shifts to the preceding Friday", () => {
  assert.equal(resolveDueDate("2026-09-19", 0, "before", NO_HOLIDAYS), "2026-09-18");
});

// Required scenario 2: an anchor landing on Thanksgiving week -- a holiday
// that isn't a weekend, immediately followed by one that is, so getting
// this right means skipping a holiday AND a weekend in the same walk.
test("addBusinessDays: crosses a holiday that falls on a weekday", () => {
  const holidays = new Set(["2026-11-26"]); // Thursday
  // Wed 25th + 1 business day: Thu 26th is a holiday (skipped) -> Fri 27th.
  assert.equal(addBusinessDays("2026-11-25", 1, holidays), "2026-11-27");
});

test("addBusinessDays: crosses the holiday+weekend cluster right after Thanksgiving", () => {
  const holidays = new Set(["2026-11-26"]);
  // Wed 25th + 2 business days: Thu 26th (holiday, skip), Fri 27th (1),
  // Sat 28th / Sun 29th (skip), Mon 30th (2).
  assert.equal(addBusinessDays("2026-11-25", 2, holidays), "2026-11-30");
});

test("resolveDueDate: anchored on Thanksgiving itself, rule='after' lands on the Friday", () => {
  const holidays = new Set(["2026-11-26"]);
  assert.equal(resolveDueDate("2026-11-26", 0, "after", holidays), "2026-11-27");
});

test("resolveDueDate: anchored on Thanksgiving itself, rule='before' lands on the Wednesday", () => {
  const holidays = new Set(["2026-11-26"]);
  assert.equal(resolveDueDate("2026-11-26", 0, "before", holidays), "2026-11-25");
});

// Required scenario 3: 31 January, a month-end anchor -- must roll into
// February without landing on an invalid or clamped date.
test("resolveDueDate: 31 January (a Saturday) rule='after' rolls into February", () => {
  assert.equal(resolveDueDate("2026-01-31", 0, "after", NO_HOLIDAYS), "2026-02-02");
});

test("resolveDueDate: 31 January (a Saturday) rule='before' stays in January", () => {
  assert.equal(resolveDueDate("2026-01-31", 0, "before", NO_HOLIDAYS), "2026-01-30");
});

test("addBusinessDays: counting forward from a month-end anchor crosses into the next month", () => {
  // Fri 30th + 3 business days: Sat 31st / Sun 1st (skip), Mon 2nd (1),
  // Tue 3rd (2), Wed 4th (3).
  assert.equal(addBusinessDays("2026-01-30", 3, NO_HOLIDAYS), "2026-02-04");
});

// Required scenario 4: 31 December crossing the year boundary.
test("addBusinessDays: counting forward from 31 December crosses the year boundary", () => {
  // Wed 31st Dec 2031 + 2 business days, no holidays in this set: Thu 1st
  // Jan (1), Fri 2nd Jan (2).
  assert.equal(addBusinessDays("2031-12-31", 2, NO_HOLIDAYS), "2032-01-02");
});

test("addBusinessDays: crosses the year boundary and skips New Year's Day", () => {
  const holidays = new Set(["2032-01-01"]);
  // Wed 31st Dec + 1 business day: Thu 1st Jan is a holiday (skip) -> Fri 2nd.
  assert.equal(addBusinessDays("2031-12-31", 1, holidays), "2032-01-02");
});

test("resolveDueDate: anchored on New Year's Day, rule='before' rolls back into the prior year", () => {
  const holidays = new Set(["2032-01-01"]);
  assert.equal(resolveDueDate("2032-01-01", 0, "before", holidays), "2031-12-31");
});

test("resolveDueDate: offset > 0 ignores rule entirely", () => {
  // Anchor is a business day and rule is 'before', but offset > 0 always
  // counts forward -- rule must have no effect here.
  assert.equal(
    resolveDueDate("2026-09-16", 3, "before", NO_HOLIDAYS),
    addBusinessDays("2026-09-16", 3, NO_HOLIDAYS),
  );
});

test("resolveDueDate: offset=0, rule='none' never shifts, even off a weekend", () => {
  assert.equal(resolveDueDate("2026-09-19", 0, "none", NO_HOLIDAYS), "2026-09-19");
});
