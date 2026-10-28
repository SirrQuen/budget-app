import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { SIGNED_IN_COOKIE, SIGNED_IN_MAX_AGE_S } from "@/lib/auth/signedInFlag";
import { welcomeDay } from "@/lib/welcome";
import { sessionTimeZone, setConfirmedWelcome } from "@/lib/auth/welcomeCookies";
import { markSessionStart } from "@/lib/auth/firstSession";
import { confirmFailure } from "@/lib/auth/errors";
import { linkOutcomePath } from "@/lib/auth/linkOutcome";
import { serviceUnavailable } from "@/lib/supabase/middleware";
import { interstitialPath, isRecoveryLink, readOtpLink, safeNext } from "@/lib/auth/confirmLink";

// The email-link callback for both signup confirmation and password recovery.
//
// Two link shapes land here, and this route handles both:
//
//  1. A {{ .ConfirmationURL }} link, as in Supabase's DEFAULT confirmation
//     email. It points at Supabase's own /auth/v1/verify
//     endpoint, which confirms the address server-side and 302s back here
//     with `?code=<uuid>` (PKCE flow). If that token was already spent it
//     instead bounces back with `?error=access_denied&error_code=otp_expired`
//     and no code. We trade the code for a session with
//     exchangeCodeForSession().
//
//  2. Our custom template -- live in the dashboard, copied in
//     supabase/templates/confirmation.html. It links here with
//     `?token_hash=<hash>&type=email`. This is the signup path in
//     production; shape 1 is kept for links sent before the switch and any
//     default template.
//
// A GET never spends a one-time token. Link scanners (Gmail, Outlook Safe
// Links, corporate mail proxies) and link-preview fetchers GET every URL in
// an email before the recipient sees it; when this route verified on GET,
// that first fetch spent the token and the person clicking got no session.
// So a token_hash GET only forwards to the interstitial
// (app/(auth)/confirm-email), whose "Confirm and sign in" button POSTs the
// link back here, and only that POST calls verifyOtp(). Scanners don't
// submit forms. Because of that, a failed POST is a real failure, reported
// as one -- never as "already confirmed".
//
// Shape 1's token is spent by Supabase's own /verify before we see the
// request, so it can't get the same protection; its outcomes keep their
// benefit of the doubt below.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // --- Shape 2: forward to the interstitial, spending nothing -------------
  const otpLink = readOtpLink(searchParams);
  if (otpLink) redirect(interstitialPath(otpLink));

  const next = safeNext(searchParams.get("next"));
  const type = searchParams.get("type");
  const isRecovery = isRecoveryLink(type, next);

  const supabase = await createClient();

  // --- Shape 1a: default email — ?code -> exchangeCodeForSession ----------
  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await markSignedIn(supabase, isRecovery);
      redirect(next);
    }

    // A missing verifier is a confirmed signup with no session here, or a
    // reset link opened in the wrong browser -- see confirmFailure.
    const outcome = confirmFailure(error, "code", isRecovery);
    if (outcome === "unreachable") return serviceUnavailable();
    redirect(linkOutcomePath(outcome, isRecovery));
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

// The interstitial's button. The only place a token_hash is spent.
//
// Every redirect is a 303: after a POST, a 307 (redirect()'s default in a
// route handler) would make the browser POST again to the destination.
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : null;
  };
  const link = readOtpLink({ get: field });
  const seeOther = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);

  if (!link) {
    return seeOther(linkOutcomePath("incomplete", isRecoveryLink(field("type"), safeNext(field("next")))));
  }
  const isRecovery = isRecoveryLink(link.type, link.next);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type: link.type, token_hash: link.tokenHash });
  if (!error) {
    await markSignedIn(supabase, isRecovery);
    // Only here, after verifyOtp() succeeded, is the welcome queued
    // (components/WelcomeBloom.tsx): "Sorrel is yours." on the page this
    // lands on. Unconditional -- once ever, never suppressed by a date --
    // and it marks the user's day, so the daily welcome doesn't follow.
    // Every failure below goes to its honest outcome page without it.
    if (!isRecovery && data.user) {
      const day = welcomeDay(await sessionTimeZone(supabase), field("tz"), new Date());
      setConfirmedWelcome(await cookies(), day);
    }
    return seeOther(link.next);
  }

  // An outage answers 503 in place rather than redirecting; the browser
  // offers to resubmit the form on reload, which retries the same token.
  const outcome = confirmFailure(error, "otp", isRecovery);
  if (outcome === "unreachable") return serviceUnavailable();
  return seeOther(linkOutcomePath(outcome, isRecovery));
}

// A confirmed signup is a brand-new user's first sight of the app, so the
// dashboard mark plays its sign-in fold -- superseded by the welcome bloom,
// which this route always queues for a signup, so in practice the flag
// here only says "signed in" to the layout (components/SessionFlags.tsx). A recovery link does not: someone
// resetting a password is mid-task, and the flourish would be noise.
//
// This route opens a session without going through login(), so it
// captures first-session state too -- for a new signup it's the usual
// way in.
async function markSignedIn(supabase: SupabaseClient<Database>, isRecovery: boolean) {
  if (isRecovery) return;
  await markSessionStart(supabase);
  (await cookies()).set(SIGNED_IN_COOKIE, "1", {
    maxAge: SIGNED_IN_MAX_AGE_S,
    path: "/",
    sameSite: "lax",
  });
}
