import "server-only";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { hasLoggedInBefore } from "@/lib/db/profile";

// "Is this the user's first session ever?" -- decided once, at the moment
// a session is created, and carried for the life of that session.
//
// It can't be read off profiles.lastlogin later: record_login() stamps it
// on every authenticated request, so by the time the dashboard renders it
// is always set, and "prior value is null" is true for exactly one page
// load. So login() and the email-confirmation route -- the two places a
// session starts -- capture the prior value before anything overwrites it,
// and record the answer here.
//
// A browser-session cookie: it lasts until the browser closes, the user
// logs out, or they log in again (which re-decides it). httpOnly -- only
// the server reads it.
const FIRST_SESSION_COOKIE = "sorrel_first_session";

export async function markSessionStart(supabase: SupabaseClient<Database>): Promise<void> {
  const jar = await cookies();
  if (await hasLoggedInBefore(supabase)) {
    jar.delete(FIRST_SESSION_COOKIE);
  } else {
    jar.set(FIRST_SESSION_COOKIE, "1", { httpOnly: true, path: "/", sameSite: "lax" });
  }
}

export async function clearSessionStart(): Promise<void> {
  (await cookies()).delete(FIRST_SESSION_COOKIE);
}

// Absent means returning -- including sessions that predate this cookie.
export async function isFirstSession(): Promise<boolean> {
  return (await cookies()).get(FIRST_SESSION_COOKIE)?.value === "1";
}
