import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMING_UP_CARD_HREF,
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
  assert.equal(WHATS_NEW_FROM, "2026-11-20");
  assert.equal(WHATS_NEW_LAST_DAY, "2026-12-19");
  assert.equal(whatsNewVisible(WHATS_NEW_LAST_DAY, false), true);
  assert.equal(whatsNewVisible("2026-12-20", false), false);
  assert.equal(WHATS_NEW_DAYS, 30);
});

test("not before the deploy date", () => {
  assert.equal(whatsNewVisible("2026-11-19", false), false);
});

test("Got it hides this card", () => {
  assert.equal(whatsNewVisible("2026-11-25", true), false);
  assert.equal(whatsNewVisible("2026-11-25", false), true);
});

test("the cookie is named for the start date, so an earlier or later card is never hidden by it", () => {
  assert.equal(WHATS_NEW_COOKIE, "sorrel_whats_new_seen_2026-11-20");
  assert.equal(WHATS_NEW_COOKIE, `sorrel_whats_new_seen_${WHATS_NEW_FROM}`);
  // The first What's new card's cookie: dismissing it doesn't hide this one.
  assert.notEqual(WHATS_NEW_COOKIE, "sorrel_whats_new_seen_2026-11-16");
  assert.notEqual(WHATS_NEW_COOKIE, "sorrel_whats_new_seen_2027-01-05");
});

// --- who sees it ---------------------------------------------------------------

test("an account from before the card's first day sees it; one made that day or later doesn't", () => {
  assert.equal(accountExistedBefore("2026-10-01T15:00:00Z", "America/New_York"), true);
  assert.equal(accountExistedBefore("2026-11-19T12:00:00Z", "America/New_York"), true);
  assert.equal(accountExistedBefore("2026-11-20T15:00:00Z", "America/New_York"), false);
  assert.equal(accountExistedBefore("2026-11-25T15:00:00Z", "America/New_York"), false);
});

test("'before' is the user's own day: the same instant is either side of the line in two zones", () => {
  // 2026-11-20T03:00Z is still the 19th in New York, already the 20th in UTC.
  assert.equal(accountExistedBefore("2026-11-20T03:00:00Z", "America/New_York"), true);
  assert.equal(accountExistedBefore("2026-11-20T03:00:00Z", "UTC"), false);
  assert.equal(accountExistedBefore("2026-11-20T03:00:00Z", null), false); // null is UTC
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
    ["recap", "runway", "goals", "coming-up", "your-sorrel", "privacy"],
  );
  for (const item of WHATS_NEW_ITEMS) assert.doesNotMatch(item.text, /!/, item.text);
  const by = Object.fromEntries(WHATS_NEW_ITEMS.map((i) => [i.id, i.action]));
  assert.deepEqual(by.recap, { kind: "none" });
  assert.deepEqual(by.runway, { kind: "runway" });
  assert.deepEqual(by.goals, { kind: "href", href: "/goals" });
  assert.deepEqual(by["coming-up"], { kind: "card", href: COMING_UP_CARD_HREF });
  assert.deepEqual(by["your-sorrel"], { kind: "yourSorrel" });
  assert.deepEqual(by.privacy, { kind: "href", href: "/privacy" });
  assert.equal(COMING_UP_CARD_HREF, "#dash-card-upcoming");
});

test("the phone shows the first three", () => {
  assert.equal(WHATS_NEW_PHONE_LINES, 3);
});

test("the recap line goes once the recap's own week has passed", () => {
  assert.equal(RECAP_LINE_LAST_DAY, "2026-12-07");
  assert.equal(whatsNewItems("2026-11-20").length, 6);
  assert.equal(whatsNewItems("2026-12-07").length, 6);
  const later = whatsNewItems("2026-12-08");
  assert.equal(later.length, 5);
  assert.equal(later[0].id, "runway");
});
