import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];
type SubscriptionRow = Database["public"]["Tables"]["subscriptions"]["Row"];

export type DbResult<T> = { data: T; error: null } | { data: null; error: string };

// Only these columns have an UPDATE grant (see CLAUDE.md "Data layer
// rules"). id/created_at/subscription_plan/subscription_status are owned
// by handle_new_user() and the service-role billing sync -- an UPDATE
// touching any of them fails with a bare permission-denied error, so this
// type is restricted at compile time rather than left to that runtime
// surprise.
export type UpdateProfilePatch = Pick<
  ProfileUpdate,
  "first_name" | "last_name" | "username" | "phone" | "lastlogin" | "updated_at"
>;

// No `.eq("id", ...)` needed: the profiles RLS policy already scopes
// both SELECT and UPDATE to `id = auth.uid()`, and there is exactly one
// row per user, so an unfiltered query already resolves to "mine."
export async function getProfile(): Promise<DbResult<ProfileRow>> {
  const supabase = await createClient();

  const { data, error } = await supabase.from("profiles").select("*").single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

export type LoginGreeting = { firstName: string; isFirstLogin: boolean };

// Cached per-request (see lib/auth/dal.ts requireUser for the same
// pattern): app/(app)/layout.tsx calls this so the read-before-write runs
// for every entry into an authenticated route -- not just lib/auth/actions.ts
// login(), which only one of the two session-creating flows goes through
// (the email-confirmation callback in app/auth/confirm/route.ts verifies
// the OTP and redirects straight to /dashboard, bypassing login()
// entirely). The dashboard page calls it again to read the greeting values
// without a second round trip.
export const recordLogin = cache(async (): Promise<DbResult<LoginGreeting>> => {
  const profileResult = await getProfile();

  if (!profileResult.data) {
    return { data: null, error: profileResult.error };
  }

  const isFirstLogin = profileResult.data.lastlogin === null;

  const updateResult = await updateProfile({ lastlogin: new Date().toISOString() });

  if (!updateResult.data) {
    return { data: null, error: updateResult.error };
  }

  return {
    data: { firstName: profileResult.data.first_name, isFirstLogin },
    error: null,
  };
});

export async function updateProfile(
  patch: UpdateProfilePatch,
): Promise<DbResult<ProfileRow>> {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userid = claimsData?.claims?.sub;

  if (claimsError || !userid) {
    return { data: null, error: "No authenticated user session." };
  }

  // PostgREST rejects an UPDATE with no filter (error 21000), so this .eq
  // is required even though RLS already scopes the row -- filtering here
  // is for PostgREST's benefit, not security.
  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", userid)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

// username_is_available(text) is SECURITY DEFINER and granted to anon
// (it has to run before signup, when there's no session yet), so this
// deliberately does not touch the profiles table directly.
export async function checkUsernameAvailable(
  username: string,
): Promise<DbResult<boolean>> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("username_is_available", {
    p_username: username,
  });

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

// Read-only by design: subscriptions has no INSERT/UPDATE/DELETE policy
// for `authenticated`, and those grants are revoked -- billing state is
// written only by the service-role webhook handler. Do not add a write
// function here.
//
// maybeSingle(), not single(): a user with no billing row yet is a normal
// state, not an error -- .single() would throw PGRST116 for it.
export async function getSubscription(): Promise<DbResult<SubscriptionRow | null>> {
  const supabase = await createClient();

  const { data, error } = await supabase.from("subscriptions").select("*").maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data, error: null };
}
