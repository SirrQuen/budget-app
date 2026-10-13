import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SIGNED_IN_COOKIE, SIGNED_IN_MAX_AGE_S } from "@/lib/auth/signedInFlag";
import { markSessionStart } from "@/lib/auth/firstSession";
import { confirmFailure, type ConfirmFailure } from "@/lib/auth/errors";
import { linkOutcomePath } from "@/lib/auth/linkOutcome";
import { serviceUnavailable } from "@/lib/supabase/middleware";

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
//
// The same goes for a code link opened in a browser that didn't start the
// signup — the email read on a phone, in a mail app's own browser. Supabase
// confirmed the address before issuing the code; only the session can't be
// opened here. That's the common tester path, and it's success too.
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

  // An outage answers 503 in place rather than redirecting, so a reload
  // retries this same link once the auth server is back.
  const afterFailure = (outcome: ConfirmFailure): Response => {
    if (outcome === "unreachable") return serviceUnavailable();
    redirect(linkOutcomePath(outcome, isRecovery));
  };

  const supabase = await createClient();

  // A confirmed signup is a brand-new user's first sight of the app, so the
  // dashboard mark plays its sign-in fold. A recovery link does not: someone
  // resetting a password is mid-task, and the flourish would be noise.
  //
  // This route opens a session without going through login(), so it
  // captures first-session state too -- for a new signup it's the usual
  // way in.
  const signedIn = async () => {
    if (isRecovery) return;
    await markSessionStart(supabase);
    (await cookies()).set(SIGNED_IN_COOKIE, "1", {
      maxAge: SIGNED_IN_MAX_AGE_S,
      path: "/",
      sameSite: "lax",
    });
  };

  // --- Shape 2: custom template — token_hash + type -> verifyOtp ----------
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      await signedIn();
      redirect(next);
    }
    // Spent or expired token. On a signup link that almost always means a
    // scanner already confirmed the address; on a recovery link it's a dead
    // end the user must retry.
    return afterFailure(confirmFailure(error, "otp", isRecovery));
  }

  // --- Shape 1a: default email — ?code -> exchangeCodeForSession ----------
  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await signedIn();
      redirect(next);
    }

    // A missing verifier is a confirmed signup with no session here, or a
    // reset link opened in the wrong browser -- see confirmFailure.
    return afterFailure(confirmFailure(error, "code", isRecovery));
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
    // to their inbox — still calm, never an alarm. A recovery link gets no
    // such benefit of the doubt: otp_expired is all Supabase tells us, so
    // that's what the copy says.
    const usedOrExpired =
      errorCode === "otp_expired" || errorCode === "access_denied";
    if (!isRecovery && usedOrExpired) redirect(linkOutcomePath("confirmed", false));
    if (isRecovery && errorCode === "otp_expired") {
      redirect(linkOutcomePath("reset-expired", true));
    }
    console.error(`[auth:confirm] verify redirected with error=${errorParam} error_code=${errorCode}`);
    redirect(linkOutcomePath("failed", isRecovery));
  }

  // --- Nothing usable in the URL: a malformed or truncated link ----------
  redirect(linkOutcomePath("incomplete", isRecovery));
}
