import "server-only";
import { cookies } from "next/headers";
import { WHATS_NEW_COOKIE } from "@/lib/whatsNew";

// "Got it" on the What's new card. Like Coming up's "Got it"
// (lib/comingUpDismissed.ts) it is a cookie, not a column: a note that's
// been seen isn't data, and a page render must never write.

// The cookie's name carries the card's start date (lib/whatsNew.ts), so a
// future card starts unseen.

/** Whether this card was dismissed. Read-only: safe in a render. */
export async function getWhatsNewSeen(): Promise<boolean> {
  return (await cookies()).has(WHATS_NEW_COOKIE);
}

/** Server Function only -- a cookie can't be set once a render streams. */
export async function markWhatsNewSeen(): Promise<void> {
  (await cookies()).set(WHATS_NEW_COOKIE, "1", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 60,
  });
}
