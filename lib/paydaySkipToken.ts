import "server-only";
import { createHash } from "node:crypto";

// The skip cookie's value for one user (lib/paydaySkip.ts): the first 16
// hex characters of SHA-256 over a fixed label and the user id. Enough to
// tell two people on one browser apart; not the id.
export function paydaySkipToken(userId: string): string {
  return createHash("sha256").update(`sorrel-payday-skip:${userId}`).digest("hex").slice(0, 16);
}

/** Whether this browser's cookie says this user skipped the payday step. */
export function paydaySkipped(cookieValue: string | undefined, userId: string): boolean {
  return cookieValue !== undefined && cookieValue === paydaySkipToken(userId);
}
