import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isValidTimeZone } from "@/lib/date";
import {
  WELCOMED_ON_COOKIE,
  WELCOMED_ON_MAX_AGE_S,
  WELCOME_COOKIE,
  WELCOME_MAX_AGE_S,
  dailyWelcomeValue,
} from "@/lib/welcome";
import { greetingName } from "@/lib/displayName";

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

// The name the daily greeting uses: preferred, else first, else none --
// greetingName()'s rule. Read with the client that just opened the session.
export async function sessionGreetingName(supabase: SupabaseClient<Database>): Promise<string | null> {
  const { data } = await supabase.from("profiles").select("first_name, preferred_name").maybeSingle();
  return data ? greetingName({ firstName: data.first_name, preferredName: data.preferred_name }) : null;
}

/**
 * B: queues the confirmed welcome for the page this lands on (the host's
 * pre-paint script reads it) and marks the day. Called only from the
 * action that confirmed the signup, never from a render.
 */
export function setConfirmedWelcome(cookies: CookieStore, day: string) {
  cookies.set(WELCOME_COOKIE, "confirmed", {
    maxAge: WELCOME_MAX_AGE_S,
    path: "/",
    sameSite: "lax",
  });
  setWelcomedOn(cookies, day);
}

/**
 * A: the greeting rides in the one-shot cookie, for the host to pick up
 * as the redirect's response headers arrive; and the day is marked now,
 * before anything plays. Called only from login(), never from a render.
 */
export function setDailyWelcome(cookies: CookieStore, greeting: string, day: string) {
  cookies.set(WELCOME_COOKIE, dailyWelcomeValue(greeting), {
    maxAge: WELCOME_MAX_AGE_S,
    path: "/",
    sameSite: "lax",
  });
  setWelcomedOn(cookies, day);
}

/** Marks `day` as welcomed in this browser. */
export function setWelcomedOn(cookies: CookieStore, day: string) {
  cookies.set(WELCOMED_ON_COOKIE, day, {
    maxAge: WELCOMED_ON_MAX_AGE_S,
    path: "/",
    sameSite: "lax",
    httpOnly: true,
  });
}
