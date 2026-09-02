import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// The email-link callback for both signup confirmation and password recovery.
//
// Two link shapes land here, and this route handles both:
//
//  1. Supabase's DEFAULT confirmation email — what we send until custom SMTP
//     is configured. Its link points at Supabase's own /auth/v1/verify
//     endpoint, which confirms the address server-side and 302s back here
//     with `?code=<uuid>` (PKCE flow). If that token was already spent it
//     instead bounces back with `?error=access_denied&error_code=otp_expired`
//     and no code. We trade the code for a session with
//     exchangeCodeForSession().
//
//  2. Our custom template (supabase/templates/confirmation.html), which goes
//     live once custom SMTP is set up. It links straight here with
//     `?token_hash=<hash>&type=email`, handed to verifyOtp().
//
// Link scanners (Gmail, Outlook Safe Links, corporate mail proxies) fetch
// every URL in an email before the recipient sees it, spending the token on
// that first hit. So by the time a human clicks a signup link, "token spent"
// is the normal case and the address is already confirmed — which is success,
// not failure. Send them to log in with a calm message, never an error page.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // `next` is only ever an in-app path — never let the link smuggle an
  // absolute URL through as an open redirect.
  const nextParam = searchParams.get("next");
  const next =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/dashboard";

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // A recovery link has to reach /reset-password, which needs the session the
  // exchange establishes — so a spent recovery link is a genuine dead end the
  // user must retry. It never gets the "already confirmed" treatment.
  // `type` is set by the custom template; `next` by the flow that built the
  // link (see requestPasswordReset in lib/auth/actions.ts).
  const isRecovery =
    type === "recovery" || next.startsWith("/reset-password");

  const FAILURE = "/login?error=confirmation_failed";
  const ALREADY_CONFIRMED = "/login?notice=email_confirmed";

  const supabase = await createClient();

  // --- Shape 2: custom template — token_hash + type -> verifyOtp ----------
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) redirect(next);
    // Spent or expired token. On a signup link that almost always means a
    // scanner already confirmed the address.
    if (!isRecovery) redirect(ALREADY_CONFIRMED);
    redirect(FAILURE);
  }

  // --- Shape 1a: default email — ?code -> exchangeCodeForSession ----------
  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) redirect(next);

    // Supabase's verify endpoint issued this code, so the address is already
    // confirmed — the exchange only failed to open a session *here*. That
    // happens when the PKCE verifier cookie is missing: the link was opened
    // on a different device or browser than signup, or a scanner ran the
    // flow, or the code was already exchanged. None of these mean the
    // address is unconfirmed.
    const verifierMissing =
      error.code === "bad_code_verifier" ||
      error.code === "flow_state_not_found" ||
      error.code === "flow_state_expired";

    if (!isRecovery && verifierMissing) redirect(ALREADY_CONFIRMED);
    // A malformed code, or a transient server error — worth a retry.
    redirect(FAILURE);
  }

  // --- Shape 1b: default email — verify endpoint bounced back an error ----
  const errorCode = searchParams.get("error_code");
  const errorParam = searchParams.get("error");
  if (errorCode || errorParam) {
    // `otp_expired` is Supabase's single code for BOTH an already-used link
    // and a genuinely expired one — it does not tell them apart. On a signup
    // link the scanner-already-confirmed case dominates, so treat it as done.
    // A user whose link truly expired while still unconfirmed will hit
    // "please confirm your email" when they try to log in and be sent back
    // to their inbox — still calm, never an alarm.
    const usedOrExpired =
      errorCode === "otp_expired" || errorCode === "access_denied";
    if (!isRecovery && usedOrExpired) redirect(ALREADY_CONFIRMED);
    redirect(FAILURE);
  }

  // --- Nothing usable in the URL: a malformed or truncated link ----------
  redirect(FAILURE);
}
