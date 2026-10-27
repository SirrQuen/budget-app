// Page-lifetime signals between the welcome overlay (mounted by the
// authenticated layout) and the pages under it. Module state, not React
// context: DayNightMark and the dashboard's ready marker sit inside
// streamed page content, the overlay outside it.

let bloomClaimed = false;

/**
 * Set by the welcome overlay when it decides, on its mount, whether it
 * plays. The bloom supersedes the sign-in fold: on a load where it plays,
 * DayNightMark settles without the fold. Reset on every overlay mount, so
 * a later sign-in the same day gets its fold back.
 */
export function setBloomClaimed(claimed: boolean) {
  bloomClaimed = claimed;
}

export function isBloomClaimed(): boolean {
  return bloomClaimed;
}
