import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysISO } from "./date";
import { projectSafeToSpend, type ProjectionSchedule, type ProjectionTransaction } from "./safeToSpendProjection";
import {
  differentBillLine,
  findSameBillPairs,
  sameBillDeleteNote,
  sameBillDeleteNotes,
  sameBillKey,
  sameBillQuestionParts,
  type SameBillEntry,
  type SameBillSchedule,
} from "./sameBill";

const TODAY = "2026-11-14";
const day = (n: number) => addDaysISO(TODAY, n);

function rent(overrides: Partial<SameBillSchedule> = {}): SameBillSchedule {
  return {
    recurringId: "rent",
    name: "Rent",
    kind: "Expense",
    accountId: "checking",
    toAccountId: null,
    amount: 1850,
    nextRunDate: day(17),
    nextDueDate: day(17),
    dateToleranceDays: 0,
    endDate: null,
    occurrencesRemaining: null,
    ...overrides,
  };
}

function entry(overrides: Partial<SameBillEntry> = {}): SameBillEntry {
  return {
    transactionId: "tx-rent",
    kind: "Expense",
    accountId: "checking",
    toAccountId: null,
    amount: 1850,
    date: day(17),
    linked: false,
    ...overrides,
  };
}

test("the doubled bill: same account, amount and date -> one pair", () => {
  const pairs = findSameBillPairs([rent()], [entry()], new Set(), TODAY);
  assert.deepEqual(pairs, [
    {
      recurringId: "rent",
      transactionId: "tx-rent",
      name: "Rent",
      amount: 1850,
      kind: "Expense",
      dueDate: day(17),
      runDate: day(17),
      entryDate: day(17),
    },
  ]);
});

test("each condition is required", () => {
  const none = (s: SameBillSchedule, e: SameBillEntry) => findSameBillPairs([s], [e], new Set(), TODAY).length === 0;
  assert.ok(none(rent(), entry({ accountId: "savings" })), "another account");
  assert.ok(none(rent(), entry({ amount: 1850.01 })), "another amount, by a cent");
  assert.ok(none(rent(), entry({ kind: "Income" })), "another direction");
  assert.ok(none(rent(), entry({ date: day(18) })), "a day off a fixed date");
  assert.ok(none(rent(), entry({ linked: true })), "an entry already linked to a schedule");
  assert.ok(none(rent(), entry({ date: TODAY })), "dated today: not ahead");
  assert.ok(none(rent({ occurrencesRemaining: 0 }), entry()), "a schedule with nothing left");
  assert.ok(none(rent({ endDate: day(10) }), entry()), "a schedule that ends first");
});

test("a tolerance widens the window both ways, and no further", () => {
  const s = rent({ dateToleranceDays: 3 });
  assert.equal(findSameBillPairs([s], [entry({ date: day(14) })], new Set(), TODAY).length, 1);
  assert.equal(findSameBillPairs([s], [entry({ date: day(20) })], new Set(), TODAY).length, 1);
  assert.equal(findSameBillPairs([s], [entry({ date: day(21) })], new Set(), TODAY).length, 0);
});

test("a transfer matches only with both ends the same", () => {
  const s = rent({ kind: "Transfer", toAccountId: "card", name: "Card payment" });
  const e = entry({ kind: "Transfer", toAccountId: "card" });
  assert.equal(findSameBillPairs([s], [e], new Set(), TODAY).length, 1);
  assert.equal(findSameBillPairs([s], [{ ...e, toAccountId: "savings" }], new Set(), TODAY).length, 0);
});

test("an answered pair is never asked again", () => {
  const answered = new Set([sameBillKey("rent", "tx-rent")]);
  assert.equal(findSameBillPairs([rent()], [entry()], answered, TODAY).length, 0);
});

test("one schedule, two matching entries: the closer one pairs, the other doesn't", () => {
  const s = rent({ dateToleranceDays: 3 });
  const pairs = findSameBillPairs(
    [s],
    [entry({ transactionId: "far", date: day(19) }), entry({ transactionId: "near", date: day(16) })],
    new Set(),
    TODAY,
  );
  assert.deepEqual(pairs.map((p) => p.transactionId), ["near"]);
});

test("one entry, two matching schedules: it pairs once", () => {
  const pairs = findSameBillPairs([rent(), rent({ recurringId: "rent-2" })], [entry()], new Set(), TODAY);
  assert.equal(pairs.length, 1);
});

test("the question names the bill, the day, and both sources", () => {
  const [pair] = findSameBillPairs([rent()], [entry()], new Set(), TODAY);
  const { before, after } = sameBillQuestionParts(pair);
  assert.equal(before, "Rent · ");
  assert.equal(after, " · 1 December appears twice — once from your schedule, once as an entry you added.");

  const [apart] = findSameBillPairs([rent({ dateToleranceDays: 3 })], [entry({ date: day(18) })], new Set(), TODAY);
  assert.match(sameBillQuestionParts(apart).after, /expects it on 1 December, and you added an entry for 2 December\.$/);
  assert.doesNotMatch(after + sameBillQuestionParts(apart).after, /!/);
});

test("a 'No' reads back as a fact the person can change", () => {
  assert.equal(differentBillLine("Rent", day(17)), "You said this isn't Rent's 1 December payment.");
});

// ---------------------------------------------------------------------
// The bill counts once after "Yes", and a delete never loses it silently.
//
// The database half (the link, the step, the trigger that puts the
// occurrence back) is docs/same-bill-test.sql. This pins the forecast
// half: what each state of the schedule and the entry does to the
// projection, and that a delete which can't restore says so.
// ---------------------------------------------------------------------

function schedule(nextDue: string): ProjectionSchedule {
  return {
    recurringId: "rent",
    name: "Rent",
    kind: "Expense",
    accountId: "checking",
    fromAccountType: "Checking",
    toAccountId: null,
    toAccountType: null,
    statementDay: null,
    cardPayment: null,
    amount: 1850,
    amountLow: null,
    amountHigh: null,
    amountBasis: "fixed",
    forecastBasis: null,
    isEstimate: false,
    nextRunDate: nextDue,
    nextDueDate: nextDue,
    anchorDate: day(17),
    frequency: "Monthly",
    intervalCount: 1,
    businessDayOffset: 0,
    nonBusinessDayRule: "none",
    dateToleranceDays: 0,
    endDate: null,
    occurrencesRemaining: null,
  };
}

const entered: ProjectionTransaction = {
  transactionId: "tx-rent",
  name: "Rent",
  kind: "Expense",
  fromAccountType: "Checking",
  toAccountType: null,
  fromCountsLater: true,
  toCountsLater: false,
  amount: 1850,
  date: day(17),
};

function rentCountedOn(date: string, schedules: ProjectionSchedule[], future: ProjectionTransaction[]): number {
  const p = projectSafeToSpend({
    today: TODAY,
    cash: 5000,
    cushion: 0,
    goalHolds: [],
    schedules,
    futureTransactions: future,
    holidays: new Set(),
    fallbackWindowEnd: day(40),
  });
  return p.obligations.filter((o) => o.name === "Rent" && o.dueDate === date).length;
}

test("before an answer: the bill is subtracted twice -- the bug this exists for", () => {
  assert.equal(rentCountedOn(day(17), [schedule(day(17))], [entered]), 2);
});

test("after 'Yes': the entry stays, the schedule has stepped on -- counted once", () => {
  // confirm_same_bill() moves the cursor to the next cycle (1 January).
  assert.equal(rentCountedOn(day(17), [schedule(day(48))], [entered]), 1);
});

test("deleting the entry after 'Yes': the bill is back in the forecast, or the person was told", () => {
  const due = day(17);
  // Restorable: the trigger puts the cursor back on 1 December.
  const restorable = { transactionId: "tx-rent", transferGroupId: null, scheduleName: "Rent", occurrenceDueDate: due, restores: true, resumesOn: day(48) };
  assert.equal(rentCountedOn(due, [schedule(restorable.restores ? due : day(48))], []), 1);
  assert.equal(sameBillDeleteNote(restorable), "Rent for 1 December goes back on your schedule, so it stays in your forecast.");

  // Not restorable: nothing goes back, so the confirmation said so first.
  const gone = { ...restorable, restores: false };
  assert.equal(rentCountedOn(due, [schedule(gone.restores ? due : day(48))], []), 0);
  assert.equal(
    sameBillDeleteNote(gone),
    "Rent for 1 December won't be in your forecast after this. Your schedule picks up again on 1 January.",
  );
});

test("delete notes are keyed the way the list keys a row", () => {
  const notes = sameBillDeleteNotes([
    { transactionId: "a", transferGroupId: null, scheduleName: "Rent", occurrenceDueDate: day(17), restores: true, resumesOn: day(48) },
    { transactionId: "b", transferGroupId: "g", scheduleName: "Card", occurrenceDueDate: day(17), restores: true, resumesOn: day(48) },
  ]);
  assert.deepEqual(Object.keys(notes).sort(), ["a", "g"]);
});
