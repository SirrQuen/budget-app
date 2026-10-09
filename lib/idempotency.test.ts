import { test } from "node:test";
import assert from "node:assert/strict";
import { keyForSubmission, submissionFields } from "./idempotency";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

let minted = 0;
const mint = () => `key-${++minted}`;

const groceries = { transaction_type: "Expense", amount: "82.45", description: "Groceries" };

test("an identical resubmission reuses the key, so a landed first attempt isn't posted twice", () => {
  const first = keyForSubmission(submissionFields(form(groceries)), null, mint);
  const retry = keyForSubmission(submissionFields(form(groceries)), first, mint);
  assert.equal(retry.key, first.key);
});

test("an edited resubmission gets a new key, so the edit is never silently dropped", () => {
  const first = keyForSubmission(submissionFields(form(groceries)), null, mint);
  const edited = keyForSubmission(submissionFields(form({ ...groceries, amount: "84.45" })), first, mint);
  assert.notEqual(edited.key, first.key);
});

test("the key field and React's hidden action inputs don't count as an edit", () => {
  const first = keyForSubmission(submissionFields(form(groceries)), null, mint);
  const withKey = form({ ...groceries, idempotency_key: first.key, $ACTION_REF_1: "", $ACTION_KEY: "k1" });
  assert.equal(keyForSubmission(submissionFields(withKey), first, mint).key, first.key);
});

test("the first submission of a fill mints a key", () => {
  assert.match(keyForSubmission(submissionFields(form(groceries)), null, mint).key, /^key-/);
});
