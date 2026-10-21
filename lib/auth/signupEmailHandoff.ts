// Carries the address someone just signed up with from the "check your email"
// screen to /login, so "I've confirmed — sign in" lands on a form with the
// email already filled in.
//
// sessionStorage, not a ?email= parameter: a query string reaches the
// server's request logs and the browser's history, and an address is
// personal data we'd then hold in both. sessionStorage stays in this tab.
//
// One-shot: /login takes it and deletes it, so a later visit to /login in
// the same tab starts blank. Storage can be missing or throw (private mode,
// blocked site data); then the field is simply empty, as it always was.

export const SIGNUP_EMAIL_KEY = "sorrel_signup_email";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function sessionStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberSignupEmail(email: string, store: Store | null = sessionStore()): void {
  try {
    store?.setItem(SIGNUP_EMAIL_KEY, email);
  } catch {
    // Unavailable storage just means an empty field on /login.
  }
}

export function takeSignupEmail(store: Store | null = sessionStore()): string | null {
  try {
    const email = store?.getItem(SIGNUP_EMAIL_KEY) ?? null;
    store?.removeItem(SIGNUP_EMAIL_KEY);
    return email || null;
  } catch {
    return null;
  }
}
