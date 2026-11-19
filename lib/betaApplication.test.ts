import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  BETA_FIELD_ORDER,
  BETA_QUESTIONS,
  BETA_SECTIONS,
  EMPTY_BETA_ANSWERS,
  betaAnswersFromFormData,
  betaFirstName,
  betaSectionComplete,
  validateBetaApplication,
  type BetaAnswers,
  type BetaChoiceField,
} from "./betaApplication";

const COMPLETE: BetaAnswers = {
  full_name: "  Ann Lee ",
  email: " Ann.Lee@Example.com ",
  age_range: "age_25_34",
  describes: "describes_household",
  experience: "experience_some",
  money_methods: ["method_paper", "method_spreadsheet", "method_paper"],
  challenge: "challenge_bills",
  want: "want_safe_to_spend",
  availability: "available_yes",
  comfortable: "comfortable_yes",
  frequency: "frequency_daily",
  reason: "reason_try_early",
  consent: true,
};

// ---------------------------------------------------------------------
// Parity with migration 75: the database's check constraints are the
// same lists, code for code. SQL can't import TypeScript, so this reads
// the constraints out of the migration file.
// ---------------------------------------------------------------------
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const migrationFile = readdirSync(MIGRATIONS).find((f) => /_75_beta_applications\.sql$/.test(f));
const migration = migrationFile ? readFileSync(join(MIGRATIONS, migrationFile), "utf8") : "";

function sqlCodes(column: BetaChoiceField): string[] {
  const pattern =
    column === "money_methods"
      ? /money_methods <@ array\[([^\]]*)\]/
      : new RegExp(`check \\(${column} in \\(([^)]*)\\)\\)`);
  const match = pattern.exec(migration);
  assert.ok(match, `no check constraint for ${column} in migration 75`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test("migration 75 is on disk", () => {
  assert.ok(migrationFile, "supabase/migrations/*_75_beta_applications.sql");
});

for (const question of Object.values(BETA_QUESTIONS)) {
  test(`${question.name}: the database's list is exactly this one`, () => {
    assert.deepEqual(
      sqlCodes(question.name),
      question.options.map((o) => o.code),
    );
  });
}

test("every code is unique across the form, so a stored value names one answer", () => {
  const all = Object.values(BETA_QUESTIONS).flatMap((q) => q.options.map((o) => o.code));
  assert.equal(new Set(all).size, all.length);
});

test("every question ends with Other, and Other is a code -- never a text box", () => {
  for (const name of ["describes", "money_methods", "challenge", "want", "reason"] as const) {
    const last = BETA_QUESTIONS[name].options.at(-1)!;
    assert.equal(last.label, "Other", name);
    assert.match(last.code, /_other$/, name);
  }
});

test("the form's sections cover every field exactly once", () => {
  const fields = BETA_SECTIONS.flatMap((s) => s.fields);
  assert.equal(new Set(fields).size, fields.length);
  assert.deepEqual(
    [...fields].sort(),
    ["consent", "email", "full_name", ...Object.keys(BETA_QUESTIONS)].sort(),
  );
  assert.deepEqual(BETA_FIELD_ORDER, fields);
});

// ---------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------
test("a complete application passes, normalised", () => {
  const result = validateBetaApplication(COMPLETE);
  assert.ok(result.ok);
  assert.equal(result.application.full_name, "Ann Lee");
  assert.equal(result.application.email, "ann.lee@example.com");
  // Repeats dropped, first-seen order kept.
  assert.deepEqual(result.application.money_methods, ["method_paper", "method_spreadsheet"]);
});

test("an empty form names every field", () => {
  const result = validateBetaApplication(EMPTY_BETA_ANSWERS);
  assert.ok(!result.ok);
  assert.deepEqual(Object.keys(result.errors).sort(), [...BETA_FIELD_ORDER].sort());
});

test("a code that isn't on the list is refused, as the database would", () => {
  const result = validateBetaApplication({ ...COMPLETE, age_range: "age_12_17" });
  assert.ok(!result.ok);
  assert.deepEqual(Object.keys(result.errors), ["age_range"]);

  const many = validateBetaApplication({ ...COMPLETE, money_methods: ["method_paper", "crypto"] });
  assert.ok(!many.ok);
  assert.deepEqual(Object.keys(many.errors), ["money_methods"]);

  // A code from another question is still not on this one's list.
  const crossed = validateBetaApplication({ ...COMPLETE, want: "challenge_debt" });
  assert.ok(!crossed.ok);
});

test("name: required, trimmed, at most 100 characters", () => {
  assert.ok(!validateBetaApplication({ ...COMPLETE, full_name: "   " }).ok);
  assert.ok(validateBetaApplication({ ...COMPLETE, full_name: "x".repeat(100) }).ok);
  assert.ok(!validateBetaApplication({ ...COMPLETE, full_name: "x".repeat(101) }).ok);
});

test("email: the waitlist's rule", () => {
  assert.ok(!validateBetaApplication({ ...COMPLETE, email: "ann@" }).ok);
  assert.ok(!validateBetaApplication({ ...COMPLETE, email: "" }).ok);
});

test("consent must be given", () => {
  const result = validateBetaApplication({ ...COMPLETE, consent: false });
  assert.ok(!result.ok);
  assert.deepEqual(Object.keys(result.errors), ["consent"]);
});

test("a section is complete only when all its fields are answered", () => {
  const [about, budgeting] = BETA_SECTIONS;
  const partial = { ...EMPTY_BETA_ANSWERS, full_name: "Ann", email: "ann@example.com", age_range: "age_18_24" };
  assert.equal(betaSectionComplete(about, partial), false);
  assert.equal(betaSectionComplete(about, { ...partial, describes: "describes_other" }), true);
  assert.equal(betaSectionComplete(budgeting, partial), false);
  for (const section of BETA_SECTIONS) assert.equal(betaSectionComplete(section, COMPLETE), true);
});

test("form data: only the form's fields are read, the honeypot isn't an answer", () => {
  const form = new FormData();
  form.set("full_name", "Ann Lee");
  form.set("email", "ann@example.com");
  form.append("money_methods", "method_app");
  form.append("money_methods", "method_other");
  form.set("consent", "yes");
  form.set("website", "spam.example");
  form.set("is_admin", "true");
  const answers = betaAnswersFromFormData(form);
  assert.deepEqual(answers.money_methods, ["method_app", "method_other"]);
  assert.equal(answers.consent, true);
  assert.deepEqual(Object.keys(answers).sort(), Object.keys(EMPTY_BETA_ANSWERS).sort());
});

test("consent is only the box's own value", () => {
  const form = new FormData();
  form.set("consent", "on");
  assert.equal(betaAnswersFromFormData(form).consent, false);
});

test("the thank-you uses the first word of the name", () => {
  assert.equal(betaFirstName("  Ann   Marie Lee "), "Ann");
  assert.equal(betaFirstName("Cher"), "Cher");
});
