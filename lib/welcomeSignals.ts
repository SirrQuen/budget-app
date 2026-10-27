// Page-lifetime signals from the authenticated layout to the pages under
// it. Module state, not React context: the layout's consumer
// (components/SessionFlags.tsx) mounts outside the streamed page content
// that DayNightMark lives in.

let signInFold = false;
let landingPath: string | null = null;

/**
 * Set once per layout mount from the server's read of the sign-in cookie:
 * the fold plays on this landing only if the user just signed in AND no
 * welcome bloom is playing -- the bloom supersedes it, they never play
 * together.
 */
export function offerSignInFold(play: boolean, path: string) {
  signInFold = play;
  landingPath = path;
}

/** Leaving the landing page drops an unclaimed fold: it never plays later. */
export function dropSignInFold() {
  signInFold = false;
}

/**
 * DayNightMark's one read: true at most once, and only on the page the
 * user landed on. An empty-state dashboard that never mounts the mark
 * leaves nothing behind for a later dashboard.
 */
export function takeSignInFold(path: string): boolean {
  const play = signInFold && path === landingPath;
  signInFold = false;
  return play;
}
