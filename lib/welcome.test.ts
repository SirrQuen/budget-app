import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WELCOMED_ON_MAX_AGE_S,
  dailyGreeting,
  hourInZone,
  WELCOME_SCRIPT,
  dailyWelcomeValue,
  parseWelcomeCookie,
  shouldWelcomeToday,
  welcomeDay,
} from "./welcome";

// WELCOME_SCRIPT runs inline before first paint on every full page load,
// public pages included. Run it against a stand-in document.
function runScript(cookie: string | (() => string), present = true) {
  const el = { hidden: true, removeAttribute(name: string) { if (name === "hidden") this.hidden = false; } };
  const document = {
    get cookie() { return typeof cookie === "function" ? cookie() : cookie; },
    getElementById: (id: string) => (present && id === "welcome-bloom" ? el : null),
  };
  new Function("document", WELCOME_SCRIPT)(document);
  return el.hidden;
}

test("pre-paint script: reveals the host for exactly sorrel_welcome=confirmed", () => {
  assert.equal(runScript("sorrel_welcome=confirmed"), false);
  assert.equal(runScript("a=1; sorrel_welcome=confirmed; b=2"), false);
});

test("pre-paint script: stays hidden without the cookie, or with any other value", () => {
  assert.equal(runScript(""), true);
  assert.equal(runScript("sorrel_signed_in=1"), true);
  assert.equal(runScript("sorrel_welcome=daily"), true);
  assert.equal(runScript("sorrel_welcome=confirmedX"), true);
  assert.equal(runScript("not_sorrel_welcome=confirmed"), true);
});

test("pre-paint script: fails closed -- a throw leaves it hidden, and throws nothing out", () => {
  assert.equal(
    runScript(() => {
      throw new Error("cookies blocked");
    }),
    true,
  );
  assert.doesNotThrow(() => runScript("sorrel_welcome=confirmed", false));
});

test("pre-paint script: ignores A's daily value -- B only", () => {
  assert.equal(runScript(`sorrel_welcome=${encodeURIComponent(dailyWelcomeValue("Good evening, Test."))}`), true);
});

// As Next writes it: the value URI-encoded.
const asSet = (value: string) => `a=1; sorrel_welcome=${encodeURIComponent(value)}; b=2`;

test("welcome cookie: reads A's greeting and B's reason, nothing else", () => {
  assert.deepEqual(parseWelcomeCookie(asSet(dailyWelcomeValue("Good evening, Test."))), {
    reason: "daily",
    greeting: "Good evening, Test.",
  });
  assert.deepEqual(parseWelcomeCookie(asSet("confirmed")), { reason: "confirmed" });
  assert.equal(parseWelcomeCookie("a=1; b=2"), null);
  assert.equal(parseWelcomeCookie(asSet("daily:")), null);
  assert.equal(parseWelcomeCookie(asSet("something")), null);
  assert.equal(parseWelcomeCookie("sorrel_welcome=%E0%A4%A"), null); // undecodable
  assert.equal(parseWelcomeCookie(asSet("confirmedX")), null);
});

test("welcome cookie: a greeting with no name round-trips too", () => {
  assert.deepEqual(parseWelcomeCookie(asSet(dailyWelcomeValue("Good morning."))), {
    reason: "daily",
    greeting: "Good morning.",
  });
});

test("the welcomed-on cookie lives a week, not the browser's 400-day ceiling", () => {
  assert.equal(WELCOMED_ON_MAX_AGE_S, 7 * 24 * 60 * 60);
});

test("welcomeDay is the user's calendar day, never UTC's", () => {
  // 8:30pm EDT on Oct 27 is already Oct 28 in UTC.
  const evening = new Date("2026-10-28T00:30:00Z");
  assert.equal(welcomeDay("America/New_York", null, evening), "2026-10-27");
});

test("no stored zone yet (a brand-new user): the browser's zone from the form", () => {
  const evening = new Date("2026-10-28T00:30:00Z");
  assert.equal(welcomeDay(null, "America/New_York", evening), "2026-10-27");
});

test("the stored zone wins over the form's", () => {
  const evening = new Date("2026-10-28T00:30:00Z");
  assert.equal(welcomeDay("America/New_York", "Asia/Tokyo", evening), "2026-10-27");
});

test("a junk form zone is ignored: UTC, the documented fallback", () => {
  const evening = new Date("2026-10-28T00:30:00Z");
  assert.equal(welcomeDay(null, "Not/AZone", evening), "2026-10-28");
  assert.equal(welcomeDay(null, null, evening), "2026-10-28");
});

// The daily decision as the sign-in action runs it: each sign-in reads the
// cookie the previous one left -- the date alone.
function signIns(instants: string[]): boolean[] {
  let cookie: string | undefined;
  return instants.map((iso) => {
    const day = welcomeDay("America/New_York", null, new Date(iso));
    const play = shouldWelcomeToday(cookie, day);
    if (play) cookie = day;
    return play;
  });
}

test("daily: twice the same day blooms once; the next day blooms again", () => {
  assert.deepEqual(signIns(["2026-10-27T13:00:00Z", "2026-10-27T18:00:00Z", "2026-10-28T13:00:00Z"]), [
    true,
    false,
    true,
  ]);
});

test("daily: 11:55pm then 12:05am local is two blooms", () => {
  assert.deepEqual(signIns(["2026-10-28T03:55:00Z", "2026-10-28T04:05:00Z"]), [true, true]);
});

test("daily: 7:55pm then 8:05pm EDT is one bloom -- UTC's midnight isn't the user's", () => {
  assert.deepEqual(signIns(["2026-10-27T23:55:00Z", "2026-10-28T00:05:00Z"]), [true, false]);
});

test("daily: a confirmed signup's mark suppresses the daily welcome that day", () => {
  assert.equal(shouldWelcomeToday("2026-10-27", "2026-10-27"), false);
});

test("daily: no cookie (first visit, cleared, or expired after a week) welcomes", () => {
  assert.equal(shouldWelcomeToday(undefined, "2026-10-27"), true);
});

test("greeting: by local hour, with the name or no name -- never 'there'", () => {
  assert.equal(dailyGreeting(8, "Matt"), "Good morning, Matt.");
  assert.equal(dailyGreeting(12, "Matt"), "Good afternoon, Matt.");
  assert.equal(dailyGreeting(17, "Matt"), "Good evening, Matt.");
  assert.equal(dailyGreeting(8, null), "Good morning.");
});

test("hourInZone reads the wall clock in the zone, UTC for an unknown one", () => {
  assert.equal(hourInZone("America/New_York", new Date("2026-10-28T00:30:00Z")), 20);
  assert.equal(hourInZone("Not/AZone", new Date("2026-10-28T00:30:00Z")), 0);
  assert.equal(hourInZone(null, new Date("2026-10-28T00:30:00Z")), 0);
});
