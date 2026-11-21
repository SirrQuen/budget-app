import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BETA_QUESTIONS } from "./betaApplication";

// The drift guard for public.beta_applications_readable (migration 78).
// The /beta form's wording lives in two places: BETA_QUESTIONS (what the
// applicant read) and the view's values list (what the operator reads in
// the dashboard). SQL can't import TypeScript, so this reads the view out
// of the migration file and fails on ANY difference, either way round --
// the same idea as test:parity. Change a label in one, change it in the
// other, in the same commit.

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const file = readdirSync(MIGRATIONS).find((f) => /_78_beta_applications_readable\.sql$/.test(f));
const sql = file ? readFileSync(join(MIGRATIONS, file), "utf8") : "";

/** The view's ('field', 'code', 'label') rows, SQL quoting undone ('' -> '). */
function viewLabels(): Map<string, string> {
  const block = /with labels\(field, code, label\) as \(\s*values\s*([\s\S]*?)\n\)/.exec(sql);
  assert.ok(block, "no `with labels(field, code, label) as (values ...)` in migration 78");
  const rows = new Map<string, string>();
  for (const m of block[1].matchAll(/\('([a-z_]+)', '([a-z0-9_]+)', '((?:[^']|'')*)'\)/g)) {
    const key = `${m[1]}|${m[2]}`;
    assert.ok(!rows.has(key), `the view lists ${key} twice`);
    rows.set(key, m[3].replace(/''/g, "'"));
  }
  // Every non-blank line of the block must have been a row: a row the
  // pattern can't read would otherwise drop out of the comparison silently.
  const lines = block[1].split("\n").filter((l) => l.trim() !== "");
  assert.equal(rows.size, lines.length, "a line of the view's labels list couldn't be read");
  return rows;
}

function formLabels(): Map<string, string> {
  const rows = new Map<string, string>();
  for (const question of Object.values(BETA_QUESTIONS)) {
    for (const o of question.options) rows.set(`${question.name}|${o.code}`, o.label);
  }
  return rows;
}

/**
 * Every difference between the form's labels and the view's, either way
 * round: a form option the view lacks, a different wording, a view row the
 * form doesn't offer. Empty means identical.
 */
function labelDrift(form: ReadonlyMap<string, string>, view: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  for (const [key, label] of form) {
    if (!view.has(key)) problems.push(`missing in the view: ${key} ("${label}")`);
    else if (view.get(key) !== label) problems.push(`different wording: ${key} (form "${label}", view "${view.get(key)}")`);
  }
  for (const [key, label] of view) {
    if (!form.has(key)) problems.push(`not on the form: ${key} ("${label}")`);
  }
  return problems;
}

test("migration 78 is on disk", () => {
  assert.ok(file, "supabase/migrations/*_78_beta_applications_readable.sql");
});

test("the view's labels are exactly the form's: every code, every word, nothing extra", () => {
  assert.deepEqual(labelDrift(formLabels(), viewLabels()), []);
});

test("the view translates every question's column", () => {
  for (const field of Object.keys(BETA_QUESTIONS)) {
    const lookup =
      field === "money_methods"
        ? /l\.field = 'money_methods' and l\.code = m\.code/
        : new RegExp(`l\\.field = '${field}' and l\\.code = b\\.${field}\\b`);
    assert.match(sql, lookup, `the view doesn't look ${field} up in its labels`);
  }
});

test("an unknown code is shown, never hidden or null", () => {
  // One fallback per single-answer question, and one inside the list.
  const singles = Object.values(BETA_QUESTIONS).filter((q) => q.kind === "one").length;
  assert.equal((sql.match(/'\[unknown: ' \|\| coalesce\(b\.[a-z_]+, 'null'\) \|\| '\]'/g) ?? []).length, singles);
  assert.match(sql, /'\[unknown: ' \|\| coalesce\(m\.code, 'null'\) \|\| '\]'/);
});

test("the guard itself catches drift, in both directions", () => {
  // The same comparison as above, on a view list with one of each fault:
  // a hyphen for an en dash, a dropped code, a code the form never had.
  const view = new Map(viewLabels());
  view.set("age_range|age_25_34", "25-34");
  view.delete("reason|reason_other");
  view.set("reason|reason_new", "New reason");
  assert.deepEqual(labelDrift(formLabels(), view), [
    'different wording: age_range|age_25_34 (form "25–34", view "25-34")',
    'missing in the view: reason|reason_other ("Other")',
    'not on the form: reason|reason_new ("New reason")',
  ]);
});
