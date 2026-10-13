"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { authErrorMessage } from "@/lib/auth/errors";
import { SIGNED_IN_COOKIE, SIGNED_IN_MAX_AGE_S } from "@/lib/auth/signedInFlag";
import { markSessionStart, clearSessionStart } from "@/lib/auth/firstSession";
import { createAccount, type SignupActionState } from "@/lib/auth/signup";

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

  // The dashboard's mark plays its sign-in fold once, on this flag.
  (await cookies()).set(SIGNED_IN_COOKIE, "1", {
    maxAge: SIGNED_IN_MAX_AGE_S,
    path: "/",
    sameSite: "lax",
  });

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

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  await clearSessionStart();
  revalidatePath("/", "layout");
  redirect("/login");
}
