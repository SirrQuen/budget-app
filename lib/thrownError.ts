// Client-safe, like lib/unreachable.ts: app/error.tsx and
// components/useActionForm.ts both import it.
//
// What to tell the user when something THREW on its way to them -- a render
// that reached app/error.tsx, or a Server Action whose promise rejected.
// Distinct from lib/db/errors.ts, which describes errors we caught and
// returned. Three cases, because "whose connection failed" decides the copy
// (docs/phase-7-findings.md, "Copy: whose connection failed"):
//   - The browser is offline: the request never reached us. The ONLY place
//     "check your connection" is said.
//   - The server can't reach Supabase: an UnreachableError, recognised by its
//     digest because production redacts the message.
//   - Anything else: the generic text.
import { UNREACHABLE, isUnreachableDigest } from "@/lib/unreachable";

export const OFFLINE = "You appear to be offline. Check your connection, then try again.";
export const GENERIC =
  "Something on our end broke, not anything you did. Try again — if it keeps happening, give it a few minutes.";

export function thrownErrorMessage(error: unknown, online: boolean): string {
  if (!online) return OFFLINE;
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest === "string" && isUnreachableDigest(digest)) return UNREACHABLE;
  return GENERIC;
}
