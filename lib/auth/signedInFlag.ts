// One-shot "you just signed in" flag. login() and a successful signup
// confirmation (app/auth/confirm) set it -- never password recovery;
// components/DayNightMark.tsx reads and deletes it as the dashboard mounts
// and plays the sign-in fold. Readable by client JS on purpose (not
// httpOnly) -- it carries no auth meaning, and the short max-age means an
// unconsumed flag can't replay the sequence on some later visit.
//
// A plain module rather than an export from the client component: a
// server action importing from a "use client" file gets a client
// reference, not the string.
export const SIGNED_IN_COOKIE = "sorrel_signed_in";
export const SIGNED_IN_MAX_AGE_S = 60;
