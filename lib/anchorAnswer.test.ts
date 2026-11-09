import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anchorChoiceField,
  anchorSetAtField,
  needsAnchorAnswer,
  ANCHOR_ANSWER_REQUIRED,
  ANCHOR_ANSWER_STALE,
  parseAnchorAnswer,
  parseAnchorAnswers,
  storedAnswerApplies,
  storedChoice,
} from "./anchorAnswer";

const SET_AT = "2026-11-03T17:00:00+00:00";

function form(entries: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

test("No, add it -> counts despite its date, against the anchor shown", () => {
  const f = form([
    [anchorChoiceField("chk"), "add"],
    [anchorSetAtField("chk"), SET_AT],
  ]);
  assert.deepEqual(parseAnchorAnswer(f, "chk"), { counts_despite_anchor: true, anchor_answer_set_at: SET_AT });
});

test("Yes, already counted -> stored as false, so the date rule alone decides", () => {
  const f = form([
    [anchorChoiceField("chk"), "counted"],
    [anchorSetAtField("chk"), SET_AT],
  ]);
  assert.deepEqual(parseAnchorAnswer(f, "chk"), { counts_despite_anchor: false, anchor_answer_set_at: SET_AT });
});

// Never a default: no choice is no answer, and the database refuses the
// save when one was needed. Either default corrupts something.
test("unanswered, unknown or anchorless reads as no answer, never a default", () => {
  const none = { counts_despite_anchor: null, anchor_answer_set_at: null };
  assert.deepEqual(parseAnchorAnswer(form([[anchorSetAtField("chk"), SET_AT]]), "chk"), none);
  assert.deepEqual(
    parseAnchorAnswer(form([[anchorChoiceField("chk"), "maybe"], [anchorSetAtField("chk"), SET_AT]]), "chk"),
    none,
  );
  assert.deepEqual(parseAnchorAnswer(form([[anchorChoiceField("chk"), "add"]]), "chk"), none);
  assert.deepEqual(parseAnchorAnswer(form([]), ""), none);
});

test("each account reads its own answer -- a transfer asks about both legs", () => {
  const f = form([
    [anchorChoiceField("chk"), "add"],
    [anchorSetAtField("chk"), SET_AT],
    [anchorChoiceField("sav"), "counted"],
    [anchorSetAtField("sav"), "2026-10-01T09:00:00+00:00"],
    [anchorChoiceField("card"), "add"], // no set_at: not an answer
  ]);
  assert.deepEqual(parseAnchorAnswers(f), {
    chk: { counts_despite_anchor: true, anchor_answer_set_at: SET_AT },
    sav: { counts_despite_anchor: false, anchor_answer_set_at: "2026-10-01T09:00:00+00:00" },
  });
});

// An override is valid only against the anchor it answered.
test("a stored answer applies only to the anchor it answered, compared as instants", () => {
  const stored = { counts_despite_anchor: true, anchor_answer_set_at: SET_AT };
  assert.equal(storedAnswerApplies(stored, "2026-11-03T17:00:00Z"), true);
  assert.equal(storedAnswerApplies(stored, "2026-11-03T12:00:00-05:00"), true);
  assert.equal(storedAnswerApplies(stored, "2026-11-05T09:00:00Z"), false);
  assert.equal(storedAnswerApplies({ counts_despite_anchor: null, anchor_answer_set_at: null }, SET_AT), false);
});

test("storedChoice reads the stored answer back as the radio it was", () => {
  assert.equal(storedChoice({ counts_despite_anchor: true, anchor_answer_set_at: SET_AT }), "add");
  assert.equal(storedChoice({ counts_despite_anchor: false, anchor_answer_set_at: SET_AT }), "counted");
  assert.equal(storedChoice({ counts_despite_anchor: null, anchor_answer_set_at: null }), null);
});

test("needsAnchorAnswer recognises exactly the two database refusals", () => {
  assert.equal(needsAnchorAnswer(ANCHOR_ANSWER_REQUIRED), true);
  assert.equal(needsAnchorAnswer(ANCHOR_ANSWER_STALE), true);
  assert.equal(needsAnchorAnswer("That didn't save, and it's not something you did. Try again in a moment."), false);
  assert.equal(needsAnchorAnswer(undefined), false);
});
