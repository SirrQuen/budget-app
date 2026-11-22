// Short-lived "you just signed in" marker. login() and a successful signup
// confirmation (app/auth/confirm) set it -- never password recovery. Only
// the login form reads it now, to notice a redirect that never landed
// (nothing clears it on arrival any more: it expires on its own). It once
// drove the dashboard's sign-in fold, which docs/Roselle.md retired.
// Readable by client JS on purpose (not httpOnly) -- it carries no auth
// meaning.
//
// A plain module rather than an export from the client component: a
// server action importing from a "use client" file gets a client
// reference, not the string.
export const SIGNED_IN_COOKIE = "sorrel_signed_in";
export const SIGNED_IN_MAX_AGE_S = 60;
