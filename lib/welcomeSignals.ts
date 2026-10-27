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

// The page behind the daily welcome reports when its data has landed
// (components/WelcomeReady.tsx), so the overlay can dissolve onto a ready
// page, or keep swaying until there is one. Reset by the overlay as it
// mounts: a dashboard visited earlier in this page's life says nothing
// about the one loading now.
let pageReady = false;
const readyListeners = new Set<() => void>();

export function resetPageReady() {
  pageReady = false;
}

export function markPageReady() {
  pageReady = true;
  for (const listener of [...readyListeners]) listener();
}

/** Calls `listener` once the page is ready (now, if it already is). */
export function onPageReady(listener: () => void): () => void {
  if (pageReady) {
    listener();
    return () => {};
  }
  const once = () => {
    readyListeners.delete(once);
    listener();
  };
  readyListeners.add(once);
  return () => {
    readyListeners.delete(once);
  };
}
