import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BILL_CHOICES,
  BILLS_PROMPT_FROM,
  addedBillKeys,
  billCategoryId,
  billsCardVisible,
} from "./billsPrompt";
import { billsCardDismissCookie, BILLS_CARD_DISMISS_COOKIE } from "./billsCardDismiss";

const choice = (key: string) => BILL_CHOICES.find((c) => c.key === key)!;

const DEFAULTS = [
  { id: "rent", name: "Rent" },
  { id: "mort", name: "Mortgages" },
  { id: "tel", name: "Telephone" },
  { id: "util", name: "Utilities" },
  { id: "auto", name: "Automotive" },
  { id: "ins", name: "Insurance" },
  { id: "subs", name: "Dues & Subscriptions" },
];

test("the seven choices, in the spec's order", () => {
  assert.deepEqual(
    BILL_CHOICES.map((c) => c.label),
    ["Rent or mortgage", "Phone", "Internet", "Car payment", "Insurance", "Subscriptions", "Other"],
  );
});

test("billCategoryId: an existing active match, in order; otherwise null (the picker)", () => {
  assert.equal(billCategoryId(choice("rent"), DEFAULTS), "rent");
  assert.equal(billCategoryId(choice("rent"), DEFAULTS.filter((c) => c.id !== "rent")), "mort");
  assert.equal(billCategoryId(choice("phone"), DEFAULTS), "tel");
  assert.equal(billCategoryId(choice("internet"), DEFAULTS), "util");
  assert.equal(billCategoryId(choice("car"), DEFAULTS), "auto");
  assert.equal(billCategoryId(choice("insurance"), DEFAULTS), "ins");
  assert.equal(billCategoryId(choice("subscriptions"), DEFAULTS), "subs");
  // Archived (not in the active list): the picker, never a new category.
  assert.equal(billCategoryId(choice("phone"), DEFAULTS.filter((c) => c.id !== "tel")), null);
  assert.equal(billCategoryId(choice("other"), DEFAULTS), null);
});

test("addedBillKeys: derived from schedule names, case and spaces aside; Other never", () => {
  assert.deepEqual([...addedBillKeys(["rent", " Phone ", "Gym", ""])].sort(), ["phone", "rent"]);
  assert.equal(addedBillKeys([]).size, 0);
});

const NEW = "2026-11-18T02:55:51.18321+00:00";
const base = { firstAccountCreatedAt: NEW, timeZone: "America/New_York", today: "2026-11-17", expenseSchedules: 0, dismissed: false };

test("billsCardVisible: a new user short of three bills, within 14 days, not dismissed", () => {
  assert.equal(billsCardVisible(base), true);
  assert.equal(billsCardVisible({ ...base, expenseSchedules: 2 }), true, "one or two bills: stays");
});

test("billsCardVisible: three bills, a dismiss, or day 14 hides it", () => {
  assert.equal(billsCardVisible({ ...base, expenseSchedules: 3 }), false);
  assert.equal(billsCardVisible({ ...base, dismissed: true }), false);
  // Created 2026-11-17 in New York: shown through Nov 30, gone Dec 1.
  assert.equal(billsCardVisible({ ...base, today: "2026-11-30" }), true);
  assert.equal(billsCardVisible({ ...base, today: "2026-12-01" }), false);
});

test("billsCardVisible: an existing user never sees it", () => {
  assert.equal(billsCardVisible({ ...base, firstAccountCreatedAt: "2026-11-17T23:59:59+00:00", today: "2026-11-18" }), false);
  assert.equal(billsCardVisible({ ...base, firstAccountCreatedAt: "2026-10-01T12:00:00+00:00" }), false);
  assert.equal(billsCardVisible({ ...base, firstAccountCreatedAt: null }), false);
  assert.equal(billsCardVisible({ ...base, firstAccountCreatedAt: BILLS_PROMPT_FROM }), true);
});

test("billsCardDismissCookie: 30 days, site-wide, lax, secure on https", () => {
  assert.equal(
    billsCardDismissCookie("abc", true),
    `${BILLS_CARD_DISMISS_COOKIE}=abc; path=/; max-age=2592000; samesite=lax; secure`,
  );
});
