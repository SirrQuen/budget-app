import "server-only";
import { createClient } from "@/lib/supabase/server";
import { classifyDbError, logDbError, UNREACHABLE } from "@/lib/db/errors";

export type JoinWaitlistResult = { ok: true } | { ok: false; error: string };

// join_waitlist() (migration 51) is the only way into the table: insert-or-
// ignore, so a new address and one already on the list both come back as
// { ok: true }. Nothing here may branch on which it was -- that difference,
// surfaced, is an email-enumeration oracle.
//
// Not describeWriteError: its duplicate copy ("already exists") is exactly
// the message this must never produce, and a waitlist failure is never the
// visitor's to fix beyond trying again.
export async function joinWaitlist(email: string): Promise<JoinWaitlistResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("join_waitlist", { p_email: email });

  if (!error) return { ok: true };

  if (error.code === "P0001" && error.message === "waitlist_rate_limited") {
    // console.error, so it lands at error level in Vercel's runtime logs --
    // there's no error tracker, and a limit nobody can see is one the
    // operator learns about from a confused email. No address in the line.
    console.error(
      "[db:waitlist] RATE LIMIT TRIPPED: 100 new addresses in the last hour; join_waitlist() is refusing every sign-up until the window rolls",
    );
    return {
      ok: false,
      error: "A lot of people have signed up in the last hour, so we've paused the list for a bit. Try again later.",
    };
  }

  if (classifyDbError(error) === "network-unreachable") {
    logDbError("[db:waitlist] network-unreachable:", error);
    return { ok: false, error: UNREACHABLE };
  }

  logDbError("[db:waitlist] join failed:", error);
  return {
    ok: false,
    error: "We couldn't add you to the list just now. Your address wasn't saved. Try again in a moment.",
  };
}
