"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { authErrorMessage } from "@/lib/auth/errors";
import { SIGNED_IN_COOKIE, SIGNED_IN_MAX_AGE_S } from "@/lib/auth/signedInFlag";
import { markSessionStart, clearSessionStart } from "@/lib/auth/firstSession";
import { createAccount, type SignupActionState } from "@/lib/auth/signup";
import { sessionGreetingName, sessionTimeZone, setDailyWelcome } from "@/lib/auth/welcomeCookies";
import {
  WELCOMED_ON_COOKIE,
  WELCOME_DAILY_ENABLED,
  dailyGreeting,
  hourInZone,
  shouldWelcomeToday,
  welcomeDay,
  welcomeZone,
} from "@/lib/welcome";

export type ActionState = { error?: string; success?: string } | undefined;

export async function login(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: authErrorMessage(error) };
  }

  // Before the redirect: the dashboard load that follows stamps lastlogin.
  await markSessionStart(supabase);

  const jar = await cookies();

  // The dashboard's mark plays its sign-in fold once, on this flag --
  // unless a welcome bloom plays, which supersedes it (SessionFlags).
  jar.set(SIGNED_IN_COOKIE, "1", {
    maxAge: SIGNED_IN_MAX_AGE_S,
    path: "/",
    sameSite: "lax",
  });

  // The daily welcome (placement A): the first sign-in of the user's day
  // in this browser, decided here against the user's own calendar day --
  // never UTC, never a database column -- and marked now, before anything
  // plays. The greeting rides back in a one-shot cookie on this response;
  // the welcome host picks it up as the headers arrive, so the bloom
  // starts before the redirect's page does (lib/welcome.ts).
  if (WELCOME_DAILY_ENABLED) {
    const tz = formData.get("tz");
    const formZone = typeof tz === "string" ? tz : null;
    // Both reads at once: the name is only used on a new day, but reading
    // it in series added a round trip to the welcome's sign-in response
    // (~300ms on dev, measured), delaying the redirect's page behind it.
    const [storedZone, name] = await Promise.all([sessionTimeZone(supabase), sessionGreetingName(supabase)]);
    const now = new Date();
    const day = welcomeDay(storedZone, formZone, now);
    if (shouldWelcomeToday(jar.get(WELCOMED_ON_COOKIE)?.value, day)) {
      setDailyWelcome(jar, dailyGreeting(hourInZone(welcomeZone(storedZone, formZone), now), name), day);
    }
  }

  // A server redirect: the dashboard comes back in this same response.
  // Returning a value and navigating from the client cost every sign-in a
  // second round trip (+0.9s on Slow 4G, measured), bloom or not.
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export type { SignupActionState } from "@/lib/auth/signup";

// The work is createAccount() (lib/auth/signup.ts), which checks the invite
// code before it asks for a Supabase client.
export async function signup(
  _prevState: SignupActionState,
  formData: FormData,
): Promise<SignupActionState> {
  return createAccount(formData, async () => ({
    auth: (await createClient()).auth,
    origin: (await headers()).get("origin"),
  }));
}

// "Send a new link" on /confirm-email, after a confirmation link failed.
// One answer whatever the address: Supabase's resend returns success for an
// unknown or already-confirmed address, and the copy must not tell those
// apart either, or this form becomes an email-enumeration oracle.
export async function resendConfirmation(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    return { error: "Email is required." };
  }

  const supabase = await createClient();
  const origin = (await headers()).get("origin");

  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=/dashboard` },
  });

  if (error) {
    return { error: authErrorMessage(error) };
  }

  return {
    success:
      "If that address has an account waiting to be confirmed, a new link is on its way. It works on any device.",
  };
}

export async function requestPasswordReset(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    return { error: "Email is required." };
  }

  const supabase = await createClient();
  const origin = (await headers()).get("origin");

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/reset-password`,
  });

  // Supabase does not error on an unknown email here (by design, to avoid
  // leaking which addresses have accounts), so a real `error` at this point
  // is a genuine failure (rate limit, malformed address, etc.) worth showing.
  if (error) {
    return { error: authErrorMessage(error) };
  }

  return {
    success: "If an account exists for that email, we've sent a password reset link.",
  };
}

// Requires the recovery session that app/auth/confirm/route.ts establishes
// via verifyOtp(type: "recovery") before this page is reachable.
export async function updatePassword(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!password || !confirmPassword) {
    return { error: "Both fields are required." };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: authErrorMessage(error) };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

// Idle sign-out (components/IdleTimeout.tsx). Ends THIS session only --
// being idle on one device mustn't sign out another -- and returns rather
// than redirecting: the client follows with a full navigation to
// /login?reason=timeout, so no client state or router cache outlives the
// session. Safe to call twice (every open tab of the session times out at
// once); signing out with no session is a no-op.
export async function idleSignOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  await clearSessionStart();
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  await clearSessionStart();
  revalidatePath("/", "layout");
  redirect("/login");
}
