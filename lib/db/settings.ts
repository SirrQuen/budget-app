import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { coerceTheme, type Theme } from "@/lib/theme";
import { coerceSafeToSpendWindowPref, type SafeToSpendWindowPref } from "@/lib/safeToSpendWindow";
import type { Database } from "@/lib/database.types";
import { describeReadError, sessionUserId } from "@/lib/db/errors";
import { isValidTimeZone, todayInZone } from "@/lib/date";

type SettingsRow = Database["public"]["Tables"]["settings"]["Row"];

export type DbResult<T> = { data: T; error: null } | { data: null; error: string };

// No `.eq("userid", ...)` needed: the settings RLS policy scopes SELECT to
// `userid = auth.uid()` and handle_new_user() creates exactly one row per
// user, so an unfiltered select already resolves to "mine."
//
// maybeSingle(), not single(): the row is created by the signup trigger, but
// a session whose row somehow doesn't exist should fall back to defaults
// rather than throw PGRST116 into a layout.
//
// Cached per-request so the layout and the settings page can both ask
// without a second round trip.
export const getSettings = cache(async (): Promise<DbResult<SettingsRow | null>> => {
  const supabase = await createClient();

  const { data, error } = await supabase.from("settings").select("*").maybeSingle();

  if (error) {
    return { data: null, error: describeReadError(error, "settings") };
  }

  return { data, error: null };
});

// Never throws and never surfaces an error: the theme is chrome, and a
// settings read failing is not a reason to fail a page render. A missing
// row, an unreadable row, or an unrecognised stored value all resolve to
// the "system" default.
export const getTheme = cache(async (): Promise<Theme> => {
  const result = await getSettings();
  return coerceTheme(result.data?.theme);
});

// Never throws and never surfaces an error, same contract as getTheme --
// a settings read failing isn't a reason to fail the dashboard, and null
// (unset) is itself a legitimate, meaningful value here (see
// lib/safeToSpendWindow.ts): it means "use the dynamic default," not "we
// don't know."
export const getSafeToSpendWindowPref = cache(async (): Promise<SafeToSpendWindowPref | null> => {
  const result = await getSettings();
  return coerceSafeToSpendWindowPref(result.data?.safe_to_spend_window);
});

// settings.timezone, or null when it hasn't been reported yet (see
// components/TimezoneSync) or can't be read. Never throws, same contract as
// getTheme: null is a real state, meaning "UTC", and every caller handles it.
export const getTimeZone = cache(async (): Promise<string | null> => {
  const result = await getSettings();
  const tz = result.data?.timezone ?? null;
  return tz !== null && isValidTimeZone(tz) ? tz : null;
});

// The user's calendar day -- the only "today" server code may use. The
// process clock's zone (UTC in production) is never the user's; see
// lib/date.ts's todayInZone. The database agrees with this per request via
// apply_user_timezone() (migration 40), so current_date in a view and this
// value name the same day.
export const getToday = cache(async (): Promise<string> => {
  return todayInZone(await getTimeZone());
});

// Called by components/TimezoneSync whenever the browser's zone differs
// from the stored one -- first load after signup, or after travel.
export async function updateTimeZone(timeZone: string): Promise<DbResult<string>> {
  if (!isValidTimeZone(timeZone) || timeZone.length > 64) {
    return { data: null, error: "That timezone isn't one we recognise." };
  }

  const supabase = await createClient();

  const session = sessionUserId(await supabase.auth.getClaims(), "settings");
  if (session.userid === null) {
    return { data: null, error: session.error };
  }
  const { userid } = session;

  // Filter for PostgREST's benefit (error 21000), not security -- see updateTheme.
  const { data, error } = await supabase
    .from("settings")
    .update({ timezone: timeZone, updated_at: new Date().toISOString() })
    .eq("userid", userid)
    .select("timezone")
    .single();

  if (error) {
    return { data: null, error: describeReadError(error, "settings") };
  }

  return { data: data.timezone ?? timeZone, error: null };
}

export async function updateSafeToSpendWindowPref(
  pref: SafeToSpendWindowPref,
): Promise<DbResult<SafeToSpendWindowPref>> {
  const supabase = await createClient();

  const session = sessionUserId(await supabase.auth.getClaims(), "settings");
  if (session.userid === null) {
    return { data: null, error: session.error };
  }
  const { userid } = session;

  const { data, error } = await supabase
    .from("settings")
    .update({ safe_to_spend_window: pref, updated_at: new Date().toISOString() })
    .eq("userid", userid)
    .select("safe_to_spend_window")
    .single();

  if (error) {
    return { data: null, error: describeReadError(error, "settings") };
  }

  return { data: coerceSafeToSpendWindowPref(data.safe_to_spend_window) ?? pref, error: null };
}

export type SafeToSpendCushion = {
  /** Dollars -- the stored choice when there is one, else the suggestion. */
  amount: number;
  /** True when nothing's stored and `amount` is the suggestion. */
  isDefault: boolean;
  /** suggested_safe_to_spend_cushion() -- what "use the suggestion" resets to. */
  suggested: number;
};

// settings.safe_to_spend_cushion, or suggested_safe_to_spend_cushion() when
// it's null (see 32_safe_to_spend_projection.sql). Unlike the window pref
// this does surface an error: the cushion is part of the hero's arithmetic,
// and guessing it would show a figure that isn't what the user set.
export const getSafeToSpendCushion = cache(async (): Promise<DbResult<SafeToSpendCushion>> => {
  const supabase = await createClient();

  const [settingsRes, suggestedRes] = await Promise.all([
    getSettings(),
    supabase.rpc("suggested_safe_to_spend_cushion"),
  ]);

  if (settingsRes.error) {
    return { data: null, error: settingsRes.error };
  }
  if (suggestedRes.error) {
    return { data: null, error: describeReadError(suggestedRes.error, "settings") };
  }

  const stored = settingsRes.data?.safe_to_spend_cushion ?? null;
  const suggested = suggestedRes.data ?? 200;

  return {
    data: { amount: stored ?? suggested, isDefault: stored === null, suggested },
    error: null,
  };
});

/** null clears the stored value, going back to the suggestion. */
export async function updateSafeToSpendCushion(
  amount: number | null,
): Promise<DbResult<number | null>> {
  const supabase = await createClient();

  const session = sessionUserId(await supabase.auth.getClaims(), "settings");
  if (session.userid === null) {
    return { data: null, error: session.error };
  }
  const { userid } = session;

  const { data, error } = await supabase
    .from("settings")
    .update({ safe_to_spend_cushion: amount, updated_at: new Date().toISOString() })
    .eq("userid", userid)
    .select("safe_to_spend_cushion")
    .single();

  if (error) {
    return { data: null, error: describeReadError(error, "settings") };
  }

  return { data: data.safe_to_spend_cushion, error: null };
}

export async function updateTheme(theme: Theme): Promise<DbResult<Theme>> {
  const supabase = await createClient();

  const session = sessionUserId(await supabase.auth.getClaims(), "settings");
  if (session.userid === null) {
    return { data: null, error: session.error };
  }
  const { userid } = session;

  // PostgREST rejects an UPDATE with no filter (error 21000), so this .eq
  // is required even though RLS already scopes the row -- filtering here
  // is for PostgREST's benefit, not security.
  const { data, error } = await supabase
    .from("settings")
    .update({ theme, updated_at: new Date().toISOString() })
    .eq("userid", userid)
    .select("theme")
    .single();

  if (error) {
    return { data: null, error: describeReadError(error, "settings") };
  }

  return { data: coerceTheme(data.theme), error: null };
}
