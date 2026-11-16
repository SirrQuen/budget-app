import "server-only";
import { cookies } from "next/headers";
import { WHATS_NEW_EDITION } from "@/lib/whatsNew";

// "Got it" on the What's new card. Like Coming up's "Got it"
// (lib/comingUpDismissed.ts) it is a cookie, not a column: a note that's
// been seen isn't data, and a page render must never write.

const COOKIE = "sorrel_whats_new_seen";

/** The edition the person dismissed, if any. Read-only: safe in a render. */
export async function getWhatsNewSeen(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE)?.value;
}

/** Server Function only -- a cookie can't be set once a render streams. */
export async function markWhatsNewSeen(): Promise<void> {
  (await cookies()).set(COOKIE, WHATS_NEW_EDITION, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 60,
  });
}
