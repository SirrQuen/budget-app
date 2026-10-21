import type { EmailOtpType } from "@supabase/supabase-js";

// The token_hash link from our email templates, read from a GET's query
// string or the interstitial's POST body. Shared by app/auth/confirm/route.ts
// and the interstitial page (app/(auth)/confirm-email/page.tsx), so the page
// only ever offers a button for a link the route will accept.

// Everything verifyOtp() takes with a token_hash. Anything else in `type` is
// a malformed link, not something to hand to Supabase.
const OTP_TYPES = new Set<string>(["email", "signup", "recovery", "magiclink", "invite", "email_change"]);

export type OtpLink = { tokenHash: string; type: EmailOtpType; next: string };

type Params = { get(name: string): string | null };

// `next` is only ever an in-app path -- never let the link smuggle an
// absolute URL through as an open redirect.
export function safeNext(nextParam: string | null | undefined): string {
  return nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
    ? nextParam
    : "/dashboard";
}

export function readOtpLink(params: Params): OtpLink | null {
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (!tokenHash || !type || !OTP_TYPES.has(type)) return null;
  return { tokenHash, type: type as EmailOtpType, next: safeNext(params.get("next")) };
}

// A recovery link has to reach /reset-password with a session; it's a
// different flow everywhere it lands. `type` is set by a token_hash
// template, `next` by the flow that built a code link (requestPasswordReset
// in lib/auth/actions.ts).
export function isRecoveryLink(type: string | null, next: string): boolean {
  return type === "recovery" || next.startsWith("/reset-password");
}

// Where a GET of a token_hash link goes: the interstitial, carrying the link
// unchanged. Nothing about the token is checked or spent on the way.
export function interstitialPath(link: OtpLink): string {
  const params = new URLSearchParams({ token_hash: link.tokenHash, type: link.type, next: link.next });
  return `/confirm-email?${params}`;
}
