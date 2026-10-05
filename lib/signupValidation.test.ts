import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateConfirmPassword,
  validateEmail,
  validateFirstName,
  validateLastName,
  validatePassword,
  validatePreferredName,
  validateSignup,
} from "./signupValidation";

test("names: real names in any script pass", () => {
  for (const name of [
    "O'Brien",
    "Nguyễn",
    "García",
    "Jean-Luc",
    "Mary Ann",
    "D’Angelo", // typographic apostrophe
    "Zoë",
    "Łukasz",
    "Олександр",
    "王",
    "محمد",
    "Ngozi",
    "X Æ A-12",
  ]) {
    assert.equal(validateFirstName(name), null, name);
    assert.equal(validateLastName(name), null, name);
    assert.equal(validatePreferredName(name), null, name);
  }
});

test("first name: required, and whitespace-only counts as blank", () => {
  assert.match(validateFirstName("")!, /Enter your first name/);
  assert.match(validateFirstName("   \t ")!, /Enter your first name/);
  assert.equal(validateFirstName("  Ana  "), null);
});

test("last name and nickname: optional", () => {
  assert.equal(validateLastName(""), null);
  assert.equal(validateLastName("   "), null);
  assert.equal(validatePreferredName(""), null);
  assert.equal(validatePreferredName("   "), null);
});

test("names: length counts code points after trimming", () => {
  assert.equal(validateFirstName("a".repeat(50)), null);
  assert.equal(validateFirstName(`  ${"a".repeat(50)}  `), null);
  assert.match(validateFirstName("a".repeat(51))!, /50 characters or fewer/);
  // 50 astral characters are 100 UTF-16 units but 50 code points.
  assert.equal(validateFirstName("𠀀".repeat(50)), null);
  // Nickname matches the DB check on preferred_name (30).
  assert.equal(validatePreferredName("a".repeat(30)), null);
  assert.match(validatePreferredName("a".repeat(31))!, /nickname to 30/);
});

test("names: control characters are rejected", () => {
  assert.match(validateFirstName("Ann\u0000a")!, /hidden character/);
  assert.match(validateLastName("Smi\u0007th")!, /hidden character/);
});

test("email: blank and malformed", () => {
  assert.match(validateEmail("  ")!, /Enter your email/);
  assert.match(validateEmail("not-an-email")!, /doesn't look like/);
  assert.match(validateEmail("a@b")!, /doesn't look like/);
  assert.equal(validateEmail(" someone@example.com "), null);
});

test("password: mirrors the Supabase policy and names what's missing", () => {
  assert.match(validatePassword("")!, /Choose a password/);
  assert.equal(
    validatePassword("a"),
    "Your password still needs 8 or more characters, an uppercase letter, a number and a symbol.",
  );
  assert.equal(validatePassword("Abcdefg1"), "Your password still needs a symbol.");
  assert.equal(validatePassword("Abcdef1!"), null);
  for (const symbol of "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~") {
    assert.equal(validatePassword(`Abcdef1${symbol}`), null, symbol);
  }
});

test("confirm password", () => {
  assert.match(validateConfirmPassword("Abcdef1!", "")!, /again/);
  assert.match(validateConfirmPassword("Abcdef1!", "Abcdef1?")!, /don't match/);
  assert.equal(validateConfirmPassword("Abcdef1!", "Abcdef1!"), null);
});

test("validateSignup: a complete, valid form has no errors", () => {
  const errors = validateSignup({
    email: "someone@example.com",
    firstName: "Siobhán",
    lastName: "",
    preferredName: "",
    password: "Abcdef1!",
    confirmPassword: "Abcdef1!",
  });
  assert.ok(Object.values(errors).every((e) => e === null), JSON.stringify(errors));
});
