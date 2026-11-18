import "server-only";
import { createHash } from "node:crypto";

// A per-user cookie value for onboarding's choices -- the payday skip
// (lib/paydaySkip.ts) and the bills card's dismiss (lib/billsCardDismiss.ts):
// the first 16 hex characters of SHA-256 over a label and the user id.
// Enough to tell two people on one browser apart; never the id itself.
export function userCookieToken(label: string, userId: string): string {
  return createHash("sha256").update(`sorrel-${label}:${userId}`).digest("hex").slice(0, 16);
}

/** The skip cookie's value for one user. */
export function paydaySkipToken(userId: string): string {
  return userCookieToken("payday-skip", userId);
}

/** Whether this browser's cookie says this user skipped the payday step. */
export function paydaySkipped(cookieValue: string | undefined, userId: string): boolean {
  return cookieValue !== undefined && cookieValue === paydaySkipToken(userId);
}

/** The bills card's dismiss value for one user. */
export function billsCardDismissToken(userId: string): string {
  return userCookieToken("bills-card-dismiss", userId);
}

/** Whether this browser's cookie says this user dismissed the bills card. */
export function billsCardDismissed(cookieValue: string | undefined, userId: string): boolean {
  return cookieValue !== undefined && cookieValue === billsCardDismissToken(userId);
}
