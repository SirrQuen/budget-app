// Which idempotency key a create form sends (see createTransaction's 23505
// handling). Client-safe and pure, so it's tested directly.
//
// The key identifies one SUBMISSION, not one fill of the form. Resending
// exactly the same fields reuses it: if the first attempt landed but its
// reply was lost (a thrown action, a dropped connection), the server
// returns that row instead of posting a second. Changing anything mints a
// new key. Reusing it there would make the server return the original row
// and silently drop the edit -- the confirmation would name a figure that
// isn't what was saved. A visible duplicate is the better failure: it's
// obvious and one delete fixes it.

export type IdempotencyAttempt = { key: string; fields: string };

export const IDEMPOTENCY_FIELD = "idempotency_key";

// Every submitted field except the key itself and React's own `$ACTION_*`
// hidden inputs, in form order.
export function submissionFields(formData: FormData): string {
  const entries: [string, string][] = [];
  formData.forEach((value, name) => {
    if (name === IDEMPOTENCY_FIELD || name.startsWith("$ACTION")) return;
    entries.push([name, typeof value === "string" ? value : value.name]);
  });
  return JSON.stringify(entries);
}

export function keyForSubmission(
  fields: string,
  last: IdempotencyAttempt | null,
  mint: () => string,
): IdempotencyAttempt {
  return last !== null && last.fields === fields ? last : { key: mint(), fields };
}
