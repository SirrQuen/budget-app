// One-shot "you just signed in" flag. login() and a successful signup
// confirmation (app/auth/confirm) set it -- never password recovery. The
// authenticated layout reads it on the server and components/
// SessionFlags.tsx deletes it as the layout mounts -- on every app page,
// so an empty-state dashboard can't leave it behind -- then offers the
// sign-in fold to components/DayNightMark.tsx unless a welcome bloom is
// playing. Readable by client JS on purpose (not
// httpOnly) -- it carries no auth meaning, and the short max-age means an
// unconsumed flag can't replay the sequence on some later visit.
//
// A plain module rather than an export from the client component: a
// server action importing from a "use client" file gets a client
// reference, not the string.
export const SIGNED_IN_COOKIE = "sorrel_signed_in";
export const SIGNED_IN_MAX_AGE_S = 60;
