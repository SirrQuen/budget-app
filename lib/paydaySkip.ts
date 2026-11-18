// "My pay isn't regular, so skip this" (docs/Decide-and-Grow.md, G, step 2).
//
// A cookie, never a column: a page render never writes, and a stored flag
// is exactly what onboarding is meant to derive without. Keyed to the user
// (ruling on Phase 1) so a shared browser doesn't carry one person's skip
// to the next -- by a short hash of the user id, not the id itself: what
// made the user id wrong in sorrel_welcomed_on was a long-lived cookie
// carrying it (docs/phase-7-findings.md, A2). The server computes the
// hash (lib/paydaySkipToken.ts) and hands it to the page; the browser only
// stores what it was given.
//
// Named in the privacy policy's cookie paragraph ("skipping a setup step").

export const PAYDAY_SKIP_COOKIE = "sorrel_payday_skipped";

/** A year: the skip persists; it only matters until the first transaction anyway. */
export const PAYDAY_SKIP_MAX_AGE_S = 365 * 24 * 60 * 60;

/** The document.cookie assignment that records a skip in this browser. */
export function paydaySkipCookie(token: string, secure: boolean): string {
  return `${PAYDAY_SKIP_COOKIE}=${token}; path=/; max-age=${PAYDAY_SKIP_MAX_AGE_S}; samesite=lax${secure ? "; secure" : ""}`;
}
