import { test } from "node:test";
import assert from "node:assert/strict";
import { RECAP_PREVIEW_PARAM, recapPreviewMonth } from "./recapPreview";

const asked = { [RECAP_PREVIEW_PARAM]: "2026-10" };

test("the parameter's name is unmistakable", () => {
  assert.equal(RECAP_PREVIEW_PARAM, "__sorrelRecapPreview");
});

test("a production build ignores it", () => {
  assert.equal(recapPreviewMonth(asked, "production"), null);
});

test("so does every environment that isn't development", () => {
  assert.equal(recapPreviewMonth(asked, "test"), null);
  assert.equal(recapPreviewMonth(asked, undefined), null);
  assert.equal(recapPreviewMonth(asked, ""), null);
});

test("in development it names the month's first day", () => {
  assert.equal(recapPreviewMonth(asked, "development"), "2026-10-01");
  assert.equal(recapPreviewMonth({ [RECAP_PREVIEW_PARAM]: ["2026-09", "2026-08"] }, "development"), "2026-09-01");
});

test("anything that isn't a YYYY-MM month is ignored, even in development", () => {
  for (const bad of ["2026-13", "2026-1", "2026-10-01", "october", "", "2026-00"]) {
    assert.equal(recapPreviewMonth({ [RECAP_PREVIEW_PARAM]: bad }, "development"), null, bad);
  }
  assert.equal(recapPreviewMonth({}, "development"), null);
  assert.equal(recapPreviewMonth({ recap: "2026-10" }, "development"), null);
});
