import type { AuthError } from "@supabase/supabase-js";
import { classifyDbError, logDbError, UNREACHABLE } from "@/lib/db/errors";

// Keyed on AuthError.code (stable across SDK versions) rather than
// error.message, which Supabase can reword without notice.
const MESSAGES: Record<string, string> = {
  invalid_credentials: "Incorrect email or password.",
  email_not_confirmed:
    "Please confirm your email address before logging in — check your inbox for the confirmation link.",
  user_already_exists:
    "An account with this email already exists. Try logging in instead.",
  email_exists:
    "An account with this email already exists. Try logging in instead.",
  weak_password:
    "That password needs 8 or more characters, with an uppercase letter, a lowercase letter, a number and a symbol.",
  same_password: "Your new password must be different from your current one.",
  over_email_send_rate_limit:
    "Too many attempts. Please wait a few minutes and try again.",
  over_request_rate_limit:
    "Too many attempts. Please wait a few minutes and try again.",
  email_address_invalid: "Please enter a valid email address.",
  user_not_found: "No account found for that email.",
  user_banned: "This account has been suspended.",
  signup_disabled: "Sign-ups are currently disabled.",
};

const GENERIC = "That didn't go through. Give it another try in a moment.";

export function authErrorMessage(error: AuthError): string {
  if (error.code && MESSAGES[error.code]) {
    return MESSAGES[error.code];
  }
  // Never Supabase's own message: GoTrue's include "Database error saving
  // new user", "Database error querying schema" and, on a network failure,
  // "fetch failed" (docs/phase-7-findings.md, "Auth error text leaks
  // Supabase's raw message"). A fixed sentence to the user, the raw error
  // to the server log.
  if (classifyDbError(error) === "network-unreachable") {
    logDbError("[auth] auth server unreachable:", error);
    return UNREACHABLE;
  }
  logDbError(`[auth] unmapped auth error (code ${error.code ?? "none"}):`, error);
  return GENERIC;
}

// What app/auth/confirm/route.ts does when it can't open a session from an
// email link. `link` is which call failed: "otp" (verifyOtp, our template)
// or "code" (exchangeCodeForSession, Supabase's default email).
//
//   unreachable        the auth server didn't answer, so we learned nothing
//                      about the link. Never "already confirmed": that would
//                      tell someone an unconfirmed address is confirmed.
//                      The route answers 503 in place, so a reload retries
//                      the same link.
//   already-confirmed  a signup link whose token was spent, almost always
//                      by a mail scanner. Normal, so info, not error.
//   failed             everything else, including any spent recovery link.
export type ConfirmFailure = "unreachable" | "already-confirmed" | "failed";

const VERIFIER_MISSING = new Set(["bad_code_verifier", "flow_state_not_found", "flow_state_expired"]);

export function confirmFailure(
  error: AuthError,
  link: "otp" | "code",
  isRecovery: boolean,
): ConfirmFailure {
  if (classifyDbError(error) === "network-unreachable") {
    logDbError(`[auth:confirm] ${link} auth server unreachable:`, error);
    return "unreachable";
  }

  // On a code link, Supabase's verify endpoint already confirmed the address
  // before issuing the code; the exchange only failed to open a session
  // *here*, because the PKCE verifier cookie is missing (another device or
  // browser, a scanner, a second click).
  const spent = link === "otp" || VERIFIER_MISSING.has(error.code ?? "");
  if (!isRecovery && spent) {
    console.info(`[auth:confirm] ${link} link already used (code ${error.code ?? "none"})`);
    return "already-confirmed";
  }

  logDbError(`[auth:confirm] ${link} link failed (code ${error.code ?? "none"}):`, error);
  return "failed";
}
