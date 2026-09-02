import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { coerceTheme, type Theme } from "@/lib/theme";
import type { Database } from "@/lib/database.types";
import { describeReadError } from "@/lib/db/errors";

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

export async function updateTheme(theme: Theme): Promise<DbResult<Theme>> {
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
