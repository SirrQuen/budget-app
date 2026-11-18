// The bills card's dismiss (docs/Decide-and-Grow.md, G, addition). A cookie,
// never a column, keyed to a hash of the user id like the payday skip
// (lib/paydaySkip.ts): the server computes the value
// (lib/paydaySkipToken.ts, billsCardDismissToken) and the browser stores
// what it was given.
//
// Named in the privacy policy's cookie paragraph ("dismissing a card").

export const BILLS_CARD_DISMISS_COOKIE = "sorrel_bills_card_dismissed";

/** 30 days: the card is offered for 14 days after the first account anyway. */
export const BILLS_CARD_DISMISS_MAX_AGE_S = 30 * 24 * 60 * 60;

export function billsCardDismissCookie(token: string, secure: boolean): string {
  return `${BILLS_CARD_DISMISS_COOKIE}=${token}; path=/; max-age=${BILLS_CARD_DISMISS_MAX_AGE_S}; samesite=lax${secure ? "; secure" : ""}`;
}
