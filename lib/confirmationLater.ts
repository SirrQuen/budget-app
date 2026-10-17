import "server-only";
import { cookies } from "next/headers";

// "Hasn't landed yet": the answer that writes nothing. The occurrence
// stays exactly as it was -- in the projection, on the schedule -- and only
// leaves the confirmation queue for the rest of the user's day, then asks
// again. No column: a revised date is out of scope (docs/Recurring-
// Confirmation.md), so all this needs to remember is "not today", and a
// cookie stamped with the user's date holds that without touching the
// database. A cookie from an earlier day is ignored, so it expires itself.
//
// Value: "<today>.<key>~<key>", keys from confirmationKey().

const COOKIE = "sorrel_not_yet";

function parse(value: string | undefined, today: string): string[] {
  if (!value) return [];
  const [day, keys] = value.split(".", 2);
  return day === today && keys ? keys.split("~") : [];
}

/** Keys answered "hasn't landed yet" today. Read-only: safe in a render. */
export async function getNotYetKeys(today: string): Promise<Set<string>> {
  const store = await cookies();
  return new Set(parse(store.get(COOKIE)?.value, today));
}

/** Server Function only -- a cookie can't be set once a render streams. */
export async function addNotYetKey(key: string, today: string): Promise<void> {
  const store = await cookies();
  const keys = new Set(parse(store.get(COOKIE)?.value, today));
  keys.add(key);
  store.set(COOKIE, `${today}.${[...keys].join("~")}`, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 48,
  });
}
