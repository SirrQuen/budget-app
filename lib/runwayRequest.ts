// "See your runway" from somewhere that doesn't hold the dialog (the What's
// new card). The Safe to Spend hero owns the runway dialog, so it listens
// for this and opens it -- the same shape as lib/yourSorrel.ts. Asking opens
// a read-only view; nothing is saved.

export const OPEN_RUNWAY_EVENT = "sorrel:open-runway";

export type OpenRunwayDetail = {
  /** Set by the listener that opened it; false means nothing on this page could. */
  handled: boolean;
};

/** Asks the page's Safe to Spend card to open its runway. true when one did. */
export function requestRunway(): boolean {
  const detail: OpenRunwayDetail = { handled: false };
  window.dispatchEvent(new CustomEvent<OpenRunwayDetail>(OPEN_RUNWAY_EVENT, { detail }));
  return detail.handled;
}
