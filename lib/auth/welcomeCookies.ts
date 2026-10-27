import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isValidTimeZone } from "@/lib/date";
import {
  WELCOMED_ON_COOKIE,
  WELCOMED_ON_MAX_AGE_S,
  WELCOME_COOKIE,
  WELCOME_MAX_AGE_S,
  welcomedOnValue,
  type WelcomeReason,
} from "@/lib/welcome";

type CookieStore = {
  set: (name: string, value: string, options: Record<string, unknown>) => unknown;
};

// The signed-in user's stored zone, read with the client that just opened
// the session (a fresh createClient() in the same action may not see the
// new session's cookies yet). null when unset or not a zone Intl knows.
export async function sessionTimeZone(supabase: SupabaseClient<Database>): Promise<string | null> {
  const { data } = await supabase.from("settings").select("timezone").maybeSingle();
  const tz = data?.timezone ?? null;
  return tz !== null && isValidTimeZone(tz) ? tz : null;
}

/**
 * Queues the welcome for the next authenticated render and marks `day` as
 * welcomed on this device. Called only from an action that signed the user
 * in, never from a render.
 */
export function setWelcome(cookies: CookieStore, reason: WelcomeReason, userId: string, day: string) {
  cookies.set(WELCOME_COOKIE, reason, {
    maxAge: WELCOME_MAX_AGE_S,
    path: "/",
    sameSite: "lax",
  });
  cookies.set(WELCOMED_ON_COOKIE, welcomedOnValue(userId, day), {
    maxAge: WELCOMED_ON_MAX_AGE_S,
    path: "/",
    sameSite: "lax",
    httpOnly: true,
  });
}
