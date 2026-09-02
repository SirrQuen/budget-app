import type { AuthError } from "@supabase/supabase-js";

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
    "That password is too weak. Use at least 8 characters, mixing letters, numbers, and symbols.",
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

export function authErrorMessage(error: AuthError): string {
  if (error.code && MESSAGES[error.code]) {
    return MESSAGES[error.code];
  }
  // Fall back to Supabase's own message rather than a generic string —
  // it's still a real, specific error even if we haven't mapped its code.
  return error.message || "That didn't go through. Give it another try in a moment.";
}
