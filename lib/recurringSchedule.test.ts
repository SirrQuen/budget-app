import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confirmationOpensOn,
  paydayWindowEnd,
  expenseCommitmentDate,
  statementDayIsDueDay,
  statementDateForCycle,
} from "./recurringSchedule";

test("confirmationOpensOn rounds EARLY (anchor minus tolerance)", () => {
  assert.equal(confirmationOpensOn("2026-10-01", 3), "2026-09-28");
  assert.equal(confirmationOpensOn("2026-10-01", 0), "2026-10-01");
});

test("paydayWindowEnd rounds LATE (anchor plus tolerance)", () => {
  assert.equal(paydayWindowEnd("2026-10-01", 3), "2026-10-04");
  assert.equal(paydayWindowEnd("2026-10-01", 0), "2026-10-01");
});

// The pin: using the prompt's own (early) date for the payday window would
// shorten it and inflate the safe-to-spend hero (CLAUDE.md "Date handling").
// The two must never coincide once there's any tolerance at all, and must
// never invert.
test("the payday window end is never earlier than the confirmation prompt's open date", () => {
  const anchor = "2026-10-01";
  for (const tolerance of [0, 1, 3, 14]) {
    const opensAt = confirmationOpensOn(anchor, tolerance);
    const windowEnd = paydayWindowEnd(anchor, tolerance);
    assert.ok(windowEnd >= opensAt, `windowEnd ${windowEnd} should be >= opensAt ${opensAt}`);
    if (tolerance > 0) {
      assert.ok(windowEnd > opensAt, `windowEnd ${windowEnd} should be > opensAt ${opensAt}`);
    } else {
      assert.equal(windowEnd, opensAt);
    }
  }
});

test("expenseCommitmentDate rounds EARLY (anchor minus tolerance), same formula as confirmationOpensOn", () => {
  assert.equal(expenseCommitmentDate("2026-10-01", 3), "2026-09-28");
  assert.equal(expenseCommitmentDate("2026-10-01", 0), "2026-10-01");
});

// The pin the task asked for: identical anchor and tolerance must produce
// DIFFERENT window boundaries for Income vs Expense -- Income widens late
// (a paycheck can't arrive later than expected, so the window keeps it in
// view), Expense widens early (a bill can't arrive later, only sooner, so
// safe-to-spend has to start counting it sooner). If these two ever agree,
// one of them has been "fixed" into the other's meaning.
test("an income schedule and an expense schedule with identical anchors/tolerances produce different window boundaries", () => {
  const anchor = "2026-10-01";
  for (const tolerance of [1, 3, 14]) {
    const incomeBoundary = paydayWindowEnd(anchor, tolerance);
    const expenseBoundary = expenseCommitmentDate(anchor, tolerance);
    assert.notEqual(incomeBoundary, expenseBoundary);
    assert.ok(incomeBoundary > anchor, `income boundary ${incomeBoundary} should be after the anchor`);
    assert.ok(expenseBoundary < anchor, `expense boundary ${expenseBoundary} should be before the anchor`);
  }
  // Tolerance 0 has no real asymmetry to pin -- both reduce to the anchor.
  assert.equal(paydayWindowEnd(anchor, 0), expenseCommitmentDate(anchor, 0));
});

// Reject equal only: raw day numbers, never what they clamp to.
test("statementDayIsDueDay refuses the due date's own day and nothing else", () => {
  for (let statementDay = 1; statementDay <= 31; statementDay++) {
    for (let dueDay = 1; dueDay <= 31; dueDay++) {
      assert.equal(statementDayIsDueDay(statementDay, dueDay), statementDay === dueDay, `statement ${statementDay}, due ${dueDay}`);
    }
  }
});

test("a statement day after the due day is the normal cross-month cycle, not a collision", () => {
  assert.equal(statementDateForCycle("2026-10-15", 20, "2026-10-15"), "2026-09-20");
  assert.equal(statementDayIsDueDay(20, 15), false);
  assert.equal(statementDayIsDueDay(28, 22), false);
});

// Short gaps stand, including the one only February closes: 29 and 30 both
// clamp to the 28th, so that month's window is the due date alone.
test("a month-end short gap is allowed; in February its statement lands on the due date", () => {
  assert.equal(statementDayIsDueDay(29, 30), false);
  assert.equal(statementDateForCycle("2027-01-30", 29, "2026-10-30"), "2027-01-29");
  assert.equal(statementDateForCycle("2027-02-28", 29, "2026-10-30"), "2027-02-28");
});

// The bug the anchor fixes: comparing clamped days put a cross-month cycle's
// statement on its due date whenever a short month clamped the statement
// day down to the due day.
test("a cross-month cycle keeps the previous month's statement when a short month clamps", () => {
  // Statement 31 / due 28: February.
  assert.equal(statementDateForCycle("2027-02-28", 31, "2026-10-28"), "2027-01-31");
  assert.equal(statementDateForCycle("2027-03-28", 31, "2026-10-28"), "2027-02-28");
  // Statement 30 / due 29: a short February clamps the cursor too; a leap one doesn't.
  assert.equal(statementDateForCycle("2027-02-28", 30, "2026-10-29"), "2027-01-30");
  assert.equal(statementDateForCycle("2028-02-29", 30, "2026-10-29"), "2028-01-30");
  // Statement 31 / due 30: every 30-day month, starting November 2026.
  assert.equal(statementDateForCycle("2026-11-30", 31, "2026-10-30"), "2026-10-31");
  assert.equal(statementDateForCycle("2027-02-28", 31, "2026-10-30"), "2027-01-31");
});

// The defining property, every pair, every month from 2026 to 2028 (two
// short Februaries and a leap one): a statement day on or before the due
// day closes in the due date's month, a later one in the month before, and
// either way each cycle gets its own statement (strictly after the last
// one), no earlier than the previous due date and no later than this one.
// It can equal the previous due date: statement 29 / due 28 closes on
// Feb 28, the day February's payment is due.
test("statementDateForCycle: same month when statement <= due day, previous month when later, inside its own cycle", () => {
  const iso = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const last = (y: number, m: number) => new Date(y, m, 0).getDate();
  for (let statementDay = 1; statementDay <= 31; statementDay++) {
    for (let dueDay = 1; dueDay <= 31; dueDay++) {
      const anchor = iso(2025, 12, dueDay);
      let prevDue = iso(2025, 12, dueDay);
      let prevStatement = "";
      for (let i = 0; i < 36; i++) {
        const y = 2026 + Math.floor(i / 12);
        const m = (i % 12) + 1;
        const due = iso(y, m, Math.min(dueDay, last(y, m)));
        const statement = statementDateForCycle(due, statementDay, anchor);
        const [sy, sm] = statement.split("-").map(Number);
        const label = `statement ${statementDay}, due ${due}: ${statement}`;
        if (statementDay <= dueDay) {
          assert.ok(sy === y && sm === m, label);
        } else {
          assert.ok(sm === (m === 1 ? 12 : m - 1), label);
        }
        assert.ok(prevDue <= statement && statement <= due, label);
        assert.ok(statement > prevStatement, label);
        prevDue = due;
        prevStatement = statement;
      }
    }
  }
});
