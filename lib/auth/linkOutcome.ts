import type { ConfirmFailure } from "@/lib/auth/errors";

// Where app/auth/confirm/route.ts sends someone when an email link doesn't
// open a session, and what that page says. Signup failures land on
// /confirm-email, recovery failures on /forgot-password -- either way a new
// link is one field away. A confirmed-elsewhere signup lands on /login.
//
// The copy states what happened and what to do next. It never guesses a
// cause the route can't know: "expired or used" appears only where Supabase
// itself said otp_expired, and nothing but a code link's proof says
// "confirmed".

export type LinkOutcome = Exclude<ConfirmFailure, "unreachable"> | "incomplete";

export const LINK_ERRORS = {
  // Signup, on /confirm-email (with a resend form)
  link_expired:
    "That confirmation link has expired or was already used. If you've already confirmed, log in. If not, we can send you a new link.",
  link_failed:
    "That confirmation link didn't work. If you've already confirmed, log in. If not, we can send you a new link.",
  link_incomplete:
    "That link is incomplete. Open it again from the email, or we can send you a new link.",
  // Recovery, on /forgot-password
  reset_other_browser:
    "Reset links only work in the browser you requested them from. Request a new one here to reset on this device.",
  reset_expired: "That reset link has expired or was already used. Request a new one below.",
  reset_failed: "That reset link didn't open. Request a new one below.",
  reset_incomplete:
    "That reset link is incomplete. Request a new one below, or copy the whole address from the email.",
} as const;

export type LinkError = keyof typeof LINK_ERRORS;

export const EMAIL_CONFIRMED_NOTICE = "Your email is confirmed. Log in to continue.";

export function linkOutcomePath(outcome: LinkOutcome, isRecovery: boolean): string {
  switch (outcome) {
    case "confirmed":
      return "/login?notice=email_confirmed";
    case "expired":
      return "/confirm-email?error=link_expired";
    case "reset-other-browser":
      return "/forgot-password?error=reset_other_browser";
    case "reset-expired":
      return "/forgot-password?error=reset_expired";
    case "incomplete":
      return isRecovery ? "/forgot-password?error=reset_incomplete" : "/confirm-email?error=link_incomplete";
    case "failed":
      return isRecovery ? "/forgot-password?error=reset_failed" : "/confirm-email?error=link_failed";
  }
}

// A ?error= value from the URL. Anything unrecognised shows nothing rather
// than a guess.
export function linkErrorMessage(param: string | string[] | undefined): string | undefined {
  if (typeof param !== "string" || !Object.hasOwn(LINK_ERRORS, param)) return undefined;
  return LINK_ERRORS[param as LinkError];
}
