// Page-lifetime signals between the welcome host (components/WelcomeBloom,
// in the root layout), the login form and the dashboard. Module state, not React context: these
// live in different layouts and in streamed page content.

// --- Is a welcome playing? -------------------------------------------------

let welcomeActive = false;
const welcomeEndListeners = new Set<() => void>();

/**
 * Set by the host when a welcome starts, cleared when it ends. The plant
 * (DayNightMark) and the visitor wait on it. The host is rendered before the
 * page content, so on a full load its layout effect has run first; for A it
 * is set before the login form even navigates.
 */
export function setWelcomeActive(active: boolean) {
  welcomeActive = active;
  if (!active) for (const listener of [...welcomeEndListeners]) listener();
}

export function isWelcomeActive(): boolean {
  return welcomeActive;
}

/**
 * Calls `listener` once no welcome is playing (now, if none is). The month
 * recap (MonthRecap) opens after the daily welcome, never under it.
 */
export function afterWelcome(listener: () => void): () => void {
  if (!welcomeActive) {
    listener();
    return () => {};
  }
  const once = () => {
    welcomeEndListeners.delete(once);
    listener();
  };
  welcomeEndListeners.add(once);
  return () => {
    welcomeEndListeners.delete(once);
  };
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
