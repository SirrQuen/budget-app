import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { describeReadError, describeWriteError } from "@/lib/db/errors";

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
    return { data: null, error: describeReadError(error, "profile") };
  }

  return { data, error: null };
}

export type LoginGreeting = {
  firstName: string;
  isFirstLogin: boolean;
  /**
   * lastlogin as it stood *before* this request bumped it -- i.e. when the
   * user was last active. null on the very first login. The dashboard's
   * "since you were last here" strip keys off this.
   */
  previousLoginAt: string | null;
};

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

  const previousLoginAt = profileResult.data.lastlogin;
  const isFirstLogin = previousLoginAt === null;

  const updateResult = await updateProfile({ lastlogin: new Date().toISOString() });

  if (!updateResult.data) {
    return { data: null, error: updateResult.error };
  }

  return {
    data: { firstName: profileResult.data.first_name, isFirstLogin, previousLoginAt },
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
    return {
      data: null,
      error: "Your session's expired. Log in again to pick up where you left off.",
    };
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
    return { data: null, error: describeWriteError(error, "profile") };
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
    return { data: null, error: describeReadError(error, "username") };
  }

  return { data, error: null };
}

export type Plan = {
  /** 'Free' | 'Pro' | 'Premium', or null before handle_new_user() / the
   *  billing sync has set one. Treat null as Free. */
  plan: string | null;
  /** 'Active' | 'Trialing' | 'PastDue' | 'Canceled' | 'Incomplete', or null. */
  status: string | null;
};

// The user's tier. It lives on profiles (subscription_plan /
// subscription_status), written by handle_new_user() at signup and by the
// service-role billing sync thereafter -- never by the client. This is the
// function the app uses to gate features by plan.
//
// Not to be confused with getStripeSubscription() below: that reads the
// subscriptions table, which holds Stripe billing records only and is empty
// until a user actually pays.
export async function getPlan(): Promise<DbResult<Plan>> {
  const supabase = await createClient();

  // One row per user, scoped by RLS to id = auth.uid() (see getProfile).
  // .single(): a missing profile row is a genuine error, not an empty state.
  const { data, error } = await supabase
    .from("profiles")
    .select("subscription_plan, subscription_status")
    .single();

  if (error) {
    return { data: null, error: describeReadError(error, "subscription") };
  }

  return {
    data: { plan: data.subscription_plan, status: data.subscription_status },
    error: null,
  };
}

// Reads the subscriptions table, which stores Stripe billing records only:
// stripe_customer_id, stripe_subscription_id and renewal_date are all NOT
// NULL, so a row can exist only once a user has a real Stripe subscription.
//
// A null result means "not a paying subscriber" -- a normal, expected state,
// not an error. The table has zero rows until someone pays; that is correct.
// For the user's tier, call getPlan() instead.
//
// Read-only by design: subscriptions has no INSERT/UPDATE/DELETE policy for
// `authenticated`, and those grants are revoked -- billing state is written
// only by the service-role webhook handler. Do not add a write function here.
//
// maybeSingle(), not single(): the no-row case is normal, so .single() would
// wrongly surface PGRST116 as an error.
export async function getStripeSubscription(): Promise<
  DbResult<SubscriptionRow | null>
> {
  const supabase = await createClient();

  const { data, error } = await supabase.from("subscriptions").select("*").maybeSingle();

  if (error) {
    return { data: null, error: describeReadError(error, "subscription") };
  }

  return { data, error: null };
}

export type AccountDeletionSummary = {
  accounts: number;
  transactions: number;
  goals: number;
  budgets: number;
};

// Row counts for the "what will be deleted" summary on the delete-account
// screen. Every count is unfiltered -- deletion removes all of a user's
// rows, soft-deleted ones included -- and scoped to the caller by RLS.
export async function getAccountDeletionSummary(): Promise<
  DbResult<AccountDeletionSummary>
> {
  const supabase = await createClient();

  const count = (table: "accounts" | "transactions" | "goals" | "budgets") =>
    supabase.from(table).select("*", { count: "exact", head: true });

  const [accounts, transactions, goals, budgets] = await Promise.all([
    count("accounts"),
    count("transactions"),
    count("goals"),
    count("budgets"),
  ]);

  const firstError =
    accounts.error ?? transactions.error ?? goals.error ?? budgets.error;
  if (firstError) {
    return { data: null, error: describeReadError(firstError, "account details") };
  }

  return {
    data: {
      accounts: accounts.count ?? 0,
      transactions: transactions.count ?? 0,
      goals: goals.count ?? 0,
      budgets: budgets.count ?? 0,
    },
    error: null,
  };
}

// Permanently deletes the calling user -- every owned row in public.*, then
// their auth.users row (see migration 14). Irreversible, no backup. The
// delete_own_account() function takes no argument and operates only on
// auth.uid(), so this can never touch another user; never reach for the
// service_role key to do this.
//
// After this resolves the caller's session is dead at the database (the
// auth.sessions row cascaded away) -- the action that calls this must sign
// out locally and send the user somewhere public.
export async function deleteOwnAccount(): Promise<DbResult<null>> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("delete_own_account");

  if (error) {
    // The caller (deleteAccountAction) replaces this string with its own
    // "nothing was removed" copy -- but describeWriteError still fires the
    // console.error, so a failed deletion is never silent on our side.
    return { data: null, error: describeWriteError(error, "profile") };
  }

  return { data: null, error: null };
}
