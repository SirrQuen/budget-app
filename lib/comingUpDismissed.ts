import "server-only";
import { cookies } from "next/headers";
import { parseDismissed, serializeDismissed } from "@/lib/comingUpDismissedValue";

// "Got it" on a coming-up reminder: hide the coming-up state until the
// confirm window opens, without touching the confirmation. Like "Not yet"
// (lib/confirmationLater.ts), a cookie, not a column: a reminder that's
// been seen isn't data, and a page render must never write.
//
// The key names the occurrence (confirmationKey), and the queue only ever
// applies it to the coming-up state -- once the window opens the same item
// asks "Did Rent come out?" whatever this cookie says. Keys whose due date
// has passed are dropped on every write, so the cookie stays small.

const COOKIE = "sorrel_coming_up_seen";

/** Coming-up keys dismissed and still ahead. Read-only: safe in a render. */
export async function getDismissedComingUpKeys(today: string): Promise<Set<string>> {
  const store = await cookies();
  return new Set(parseDismissed(store.get(COOKIE)?.value, today));
}

/** Server Function only -- a cookie can't be set once a render streams. */
export async function addDismissedComingUpKey(key: string, today: string): Promise<void> {
  const store = await cookies();
  const keys = new Set(parseDismissed(store.get(COOKIE)?.value, today));
  keys.add(key);
  store.set(COOKIE, serializeDismissed([...keys]), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 14,
  });
}
