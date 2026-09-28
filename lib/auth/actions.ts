"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { authErrorMessage } from "@/lib/auth/errors";
import { SIGNED_IN_COOKIE, SIGNED_IN_MAX_AGE_S } from "@/lib/auth/signedInFlag";
import { markSessionStart, clearSessionStart } from "@/lib/auth/firstSession";
import { clean, nameLength, PREFERRED_NAME_MAX } from "@/lib/displayName";

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

// Collects email/password plus an optional preferred name. First and last
// name are left to Settings -- profiles.first_name/last_name/username all
// tolerate missing signup metadata (see handle_new_user(), migration 34) and
// land blank/null rather than failing signup.
export async function signup(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const preferredName = clean(String(formData.get("preferredName") ?? ""));

  if (!email || !password || !confirmPassword) {
    return { error: "Email and both password fields are required." };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  // The DB check would reject this too, but as an opaque "Database error
  // saving new user" -- catch it here with a message that says what to fix.
  if (preferredName && nameLength(preferredName) > PREFERRED_NAME_MAX) {
    return { error: `Keep your preferred name to ${PREFERRED_NAME_MAX} characters or fewer.` };
  }

  const supabase = await createClient();
  const origin = (await headers()).get("origin");

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/confirm?next=/dashboard`,
      // Read by handle_new_user(); omitted entirely when blank.
      data: preferredName ? { preferred_name: preferredName } : undefined,
    },
  });

  if (error) {
    return { error: authErrorMessage(error) };
  }

  return {
    success: "Check your email to confirm your account before logging in.",
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

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  await clearSessionStart();
  revalidatePath("/", "layout");
  redirect("/login");
}
