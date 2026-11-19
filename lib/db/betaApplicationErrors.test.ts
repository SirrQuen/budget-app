import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BETA_GENERIC,
  BETA_RATE_LIMITED,
  betaErrorLogLine,
  describeBetaSubmitError,
} from "./betaApplicationErrors";
import { UNREACHABLE } from "@/lib/db/errors";

// The shape PostgREST returned on sorrel-dev, 2026-11-18, for an age code
// off the list (values here are made up): the detail repeats the row.
const CONSTRAINT = {
  code: "23514",
  message: 'new row for relation "beta_applications" violates check constraint "beta_applications_age_range_check"',
  details:
    "Failing row contains (326dd80c-d04e-4a11-ad8a-24d4edd83579, ann.lee@example.com, Ann Lee, age_12_17, describes_other, ...).",
  hint: null,
};

function logged(error: Parameters<typeof describeBetaSubmitError>[0]) {
  const lines: string[] = [];
  const told = describeBetaSubmitError(error, (line) => lines.push(line));
  return { lines, told };
}

test("a constraint error logs its code and nothing from the row", () => {
  const { lines, told } = logged(CONSTRAINT);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /code=23514/);
  for (const leaked of ["ann.lee@example.com", "Ann Lee", "Failing row", "age_12_17", "beta_applications_age_range_check"]) {
    assert.ok(!lines[0].includes(leaked), `log line contains ${leaked}: ${lines[0]}`);
  }
  assert.equal(told, BETA_GENERIC);
  assert.ok(!told.includes("ann.lee@example.com"));
});

test("every path logs only a fixed prefix and the code", () => {
  const cases = [
    CONSTRAINT,
    { code: "22023", message: "not a plausible email address", details: "ann.lee@example.com", hint: "Ann Lee" },
    { code: "42501", message: "permission denied", details: "ann.lee@example.com", hint: null },
    { code: "P0001", message: "beta_rate_limited", details: "ann.lee@example.com", hint: null },
    { code: "", message: "TypeError: fetch failed", details: "TypeError: fetch failed\n\nCaused by: Error: ann.lee@example.com (ECONNREFUSED)", hint: "" },
    { code: undefined, message: "Ann Lee", details: null, hint: null },
  ];
  for (const error of cases) {
    const line = betaErrorLogLine(error);
    assert.match(line, /^\[db:beta\] /);
    assert.ok(!line.includes("ann.lee@example.com"), line);
    assert.ok(!line.includes("Ann Lee"), line);
    assert.ok(!line.includes(error.message), line);
  }
});

test("what the applicant is told", () => {
  assert.equal(logged({ code: "P0001", message: "beta_rate_limited" }).told, BETA_RATE_LIMITED);
  assert.equal(
    logged({ code: "", message: "TypeError: fetch failed", details: "TypeError: fetch failed\n\nCaused by: Error: connect (ECONNREFUSED)" }).told,
    UNREACHABLE,
  );
  assert.equal(logged({ code: "XX000", message: "boom" }).told, BETA_GENERIC);
  // A P0001 that isn't the rate limit is not the rate limit.
  assert.equal(logged({ code: "P0001", message: "something else" }).told, BETA_GENERIC);
});
