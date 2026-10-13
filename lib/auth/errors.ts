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
// or "code" (exchangeCodeForSession, Supabase's default email). Each outcome
// names only what the route actually knows -- never one failure reported as
// another (docs/phase-7-findings.md, Section 10).
//
//   unreachable          the auth server didn't answer, so we learned nothing
//                        about the link. Never "confirmed": that would tell
//                        someone an unconfirmed address is confirmed. The
//                        route answers 503 in place, so a reload retries the
//                        same link.
//   confirmed            a signup link Supabase already accepted. This is
//                        success, not an error -- there is just no session in
//                        this browser. On a code link the code is the proof:
//                        /verify issues one only after it sets
//                        email_confirmed_at, so a missing verifier means only
//                        that this browser didn't start the signup (signed up
//                        on a laptop, opened the email on a phone). On an OTP
//                        link, a spent token is taken to be a mail scanner's
//                        earlier hit (see the route).
//   reset-other-browser  a recovery code link opened in a browser that didn't
//                        request it. The reset form needs a session here, so
//                        the user requests a new link on this device.
//   reset-expired        a recovery token Supabase reports as otp_expired --
//                        its one code for expired-or-used.
//   failed               anything else. Logged; the copy claims no cause.
export type ConfirmFailure =
  | "unreachable"
  | "confirmed"
  | "reset-other-browser"
  | "reset-expired"
  | "failed";

// A code exchange that found no verifier for this browser.
const VERIFIER_MISSING = new Set([
  // Raised by auth-js itself, before any request, when the verifier cookie
  // is absent -- the case every cross-device click hits.
  "pkce_code_verifier_not_found",
  // GoTrue's server-side equivalents.
  "bad_code_verifier",
  "flow_state_not_found",
  "flow_state_expired",
]);

export function confirmFailure(
  error: AuthError,
  link: "otp" | "code",
  isRecovery: boolean,
): ConfirmFailure {
  if (classifyDbError(error) === "network-unreachable") {
    logDbError(`[auth:confirm] ${link} auth server unreachable:`, error);
    return "unreachable";
  }

  const code = error.code ?? "none";
  const verifierMissing = link === "code" && VERIFIER_MISSING.has(code);

  if (!isRecovery && (link === "otp" || verifierMissing)) {
    console.info(`[auth:confirm] ${link} signup link confirmed, no session here (code ${code})`);
    return "confirmed";
  }
  if (isRecovery && verifierMissing) {
    console.info(`[auth:confirm] recovery link opened in another browser (code ${code})`);
    return "reset-other-browser";
  }
  if (isRecovery && code === "otp_expired") {
    console.info(`[auth:confirm] ${link} recovery link expired or used (code ${code})`);
    return "reset-expired";
  }

  logDbError(`[auth:confirm] ${link} link failed (code ${code}):`, error);
  return "failed";
}
