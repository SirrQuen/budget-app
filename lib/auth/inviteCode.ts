import { createHash, timingSafeEqual } from "node:crypto";

// PRIVATE BETA GATE. Signup requires the code in SORREL_INVITE_CODE. This
// file is the whole check; createAccount() (lib/auth/signup.ts) calls it
// before Supabase is touched, and the signup form has one field for it.
// When the beta opens: delete this file, its test, that call, the form
// field and the env var.
//
// Server-only by construction: the variable has no NEXT_PUBLIC_ prefix, so
// it never reaches a client bundle -- never add one.

export const INVITE_CODE_FIELD = "inviteCode";

export const INVITE_CODE_ERROR = "That invite code isn't right.";

// Shown when the server has no code configured. Not the wrong-code message:
// that would tell a visitor holding a valid code that it's wrong.
export const INVITE_UNAVAILABLE_ERROR =
  "Creating an account isn't available right now. Try again later.";

// People retype these from emails and phone calls.
const normalise = (code: string) => code.trim().toLowerCase();

// Hashed first so the comparison is constant-time over equal-length input
// and doesn't leak the code's length.
const digest = (code: string) => createHash("sha256").update(normalise(code)).digest();

export type InviteCheck =
  | { ok: true }
  | { ok: false; field?: typeof INVITE_CODE_FIELD; error: string };

export function checkInviteCode(
  submitted: string,
  expected: string | undefined = process.env.SORREL_INVITE_CODE,
): InviteCheck {
  // Fail closed: a missing variable must not open registration.
  if (!expected || normalise(expected) === "") {
    console.error(
      "[signup] SORREL_INVITE_CODE is not set -- every signup is being rejected. Set it in the deployment's environment.",
    );
    return { ok: false, error: INVITE_UNAVAILABLE_ERROR };
  }
  if (!timingSafeEqual(digest(submitted), digest(expected))) {
    return { ok: false, field: INVITE_CODE_FIELD, error: INVITE_CODE_ERROR };
  }
  return { ok: true };
}
