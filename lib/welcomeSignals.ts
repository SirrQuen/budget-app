// Page-lifetime signals between the welcome host (components/WelcomeBloom,
// in the root layout), the login form, the authenticated layout's
// SessionFlags and the dashboard. Module state, not React context: these
// live in different layouts and in streamed page content.

// --- Is a welcome playing? -------------------------------------------------

let welcomeActive = false;

/**
 * Set by the host when a welcome starts, cleared when it ends. The bloom
 * supersedes the sign-in fold: SessionFlags offers the fold only when this
 * is false. The host is rendered before the page content, so on a full
 * load its layout effect has run before SessionFlags' does; for A it is
 * set before the login form even navigates.
 */
export function setWelcomeActive(active: boolean) {
  welcomeActive = active;
}

export function isWelcomeActive(): boolean {
  return welcomeActive;
}

// --- A: the login form says a sign-in is in flight --------------------------

const signInListeners = new Set<() => void>();

/**
 * Called by the login form as it submits. The host (root layout, always
 * mounted) starts watching for the daily welcome cookie, which arrives
 * with the sign-in response's headers -- before the redirect's page can
 * render. Says nothing about success: only the cookie does, and login()
 * sets it only after a successful sign-in.
 */
export function signInSubmitted() {
  for (const listener of [...signInListeners]) listener();
}

export function onSignInSubmitted(listener: () => void): () => void {
  signInListeners.add(listener);
  return () => {
    signInListeners.delete(listener);
  };
}

// --- The sign-in fold -------------------------------------------------------

let signInFold = false;
let landingPath: string | null = null;

/**
 * Set once per authenticated-layout mount from the server's read of the
 * sign-in cookie: the fold plays on this landing only if the user just
 * signed in AND no welcome is playing.
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

// --- The page behind the daily welcome ---------------------------------------

// The dashboard reports when its data has landed (components/WelcomeReady),
// so the daily welcome can dissolve onto a ready page, or keep swaying
// until there is one. Reset by the host as A starts: a dashboard visited
// earlier in this page's life says nothing about the one loading now.
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
