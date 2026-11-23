import { test } from "node:test";
import assert from "node:assert/strict";
import { RECAP_MIN_LOGS } from "./monthStory";
import {
  RECAP_LINE_LAST_DAY,
  WHATS_NEW_COOKIE,
  WHATS_NEW_DAYS,
  WHATS_NEW_FROM,
  WHATS_NEW_ITEMS,
  WHATS_NEW_LAST_DAY,
  WHATS_NEW_PHONE_LINES,
  accountExistedBefore,
  whatsNewItems,
  whatsNewVisible,
} from "./whatsNew";

test("shows for 30 days from the deploy date, then never again", () => {
  assert.equal(whatsNewVisible(WHATS_NEW_FROM, false), true);
  assert.equal(WHATS_NEW_FROM, "2026-11-23");
  assert.equal(WHATS_NEW_LAST_DAY, "2026-12-22");
  assert.equal(whatsNewVisible(WHATS_NEW_LAST_DAY, false), true);
  assert.equal(whatsNewVisible("2026-12-23", false), false);
  assert.equal(WHATS_NEW_DAYS, 30);
});

test("not before the deploy date", () => {
  assert.equal(whatsNewVisible("2026-11-22", false), false);
});

test("Got it hides this card", () => {
  assert.equal(whatsNewVisible("2026-11-25", true), false);
  assert.equal(whatsNewVisible("2026-11-25", false), true);
});

test("the cookie is named for the start date, so an earlier or later card is never hidden by it", () => {
  assert.equal(WHATS_NEW_COOKIE, "sorrel_whats_new_seen_2026-11-23");
  assert.equal(WHATS_NEW_COOKIE, `sorrel_whats_new_seen_${WHATS_NEW_FROM}`);
  // The earlier cards' cookies: dismissing them doesn't hide this one.
  assert.notEqual(WHATS_NEW_COOKIE, "sorrel_whats_new_seen_2026-11-16");
  assert.notEqual(WHATS_NEW_COOKIE, "sorrel_whats_new_seen_2026-11-20");
  assert.notEqual(WHATS_NEW_COOKIE, "sorrel_whats_new_seen_2027-01-05");
});

// --- who sees it ---------------------------------------------------------------

test("an account from before the card's first day sees it; one made that day or later doesn't", () => {
  assert.equal(accountExistedBefore("2026-10-01T15:00:00Z", "America/New_York"), true);
  assert.equal(accountExistedBefore("2026-11-22T12:00:00Z", "America/New_York"), true);
  assert.equal(accountExistedBefore("2026-11-23T15:00:00Z", "America/New_York"), false);
  assert.equal(accountExistedBefore("2026-11-25T15:00:00Z", "America/New_York"), false);
});

test("'before' is the user's own day: the same instant is either side of the line in two zones", () => {
  // 2026-11-23T03:00Z is still the 22nd in New York, already the 23rd in UTC.
  assert.equal(accountExistedBefore("2026-11-23T03:00:00Z", "America/New_York"), true);
  assert.equal(accountExistedBefore("2026-11-23T03:00:00Z", "UTC"), false);
  assert.equal(accountExistedBefore("2026-11-23T03:00:00Z", null), false); // null is UTC
});

test("a creation time we can't read isn't eligible", () => {
  assert.equal(accountExistedBefore(null, "UTC"), false);
  assert.equal(accountExistedBefore(undefined, "UTC"), false);
  assert.equal(accountExistedBefore("not a date", "UTC"), false);
});

// --- the lines -------------------------------------------------------------------

test("six lines at most, in order, no exclamation marks, each wired to what it names", () => {
  assert.ok(WHATS_NEW_ITEMS.length <= 6);
  assert.deepEqual(
    WHATS_NEW_ITEMS.map((i) => i.id),
    ["recap", "safe-to-spend", "goals", "import", "budgets", "plant"],
  );
  for (const item of WHATS_NEW_ITEMS) assert.doesNotMatch(item.text, /!/, item.text);
  const by = Object.fromEntries(WHATS_NEW_ITEMS.map((i) => [i.id, i.action]));
  // Nothing to open: the recap until December 1st, Safe to Spend and the
  // plant are on the dashboard itself.
  assert.deepEqual(by.recap, { kind: "none" });
  assert.deepEqual(by["safe-to-spend"], { kind: "none" });
  assert.deepEqual(by.plant, { kind: "none" });
  assert.deepEqual(by.goals, { kind: "href", href: "/goals" });
  assert.deepEqual(by.import, { kind: "href", href: "/import?from=transactions" });
  assert.deepEqual(by.budgets, { kind: "href", href: "/budgets" });
});

test("the recap line promises a recap only to someone who logged enough for one", () => {
  const recap = WHATS_NEW_ITEMS.find((i) => i.id === "recap")!;
  assert.match(recap.text, /December 1st/);
  assert.equal(RECAP_MIN_LOGS, 5, "the line says five; change both together");
  assert.match(recap.text, /at least five times/);
});

test("the phone shows the first three", () => {
  assert.equal(WHATS_NEW_PHONE_LINES, 3);
});

test("the recap line goes once the recap's own week has passed", () => {
  assert.equal(RECAP_LINE_LAST_DAY, "2026-12-07");
  assert.equal(whatsNewItems("2026-11-23").length, 6);
  assert.equal(whatsNewItems("2026-12-07").length, 6);
  const later = whatsNewItems("2026-12-08");
  assert.equal(later.length, 5);
  assert.equal(later[0].id, "safe-to-spend");
});
