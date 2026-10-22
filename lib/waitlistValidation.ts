// The waitlist address rule, shared by the form (a convenience) and the
// server action (the gate). Pure -- safe to import from a Client Component.
// join_waitlist() (migration 51) applies the same rule again in SQL, for a
// caller that skips the app; change both together.

// A typo catch, not a deliverability check, same shape as signup's.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// RFC 5321's ceiling on a forward path.
export const WAITLIST_EMAIL_MAX = 254;

export type WaitlistEmail = { email: string; error: null } | { email: null; error: string };

// Trimmed and lower-cased, so "Ann@Example.com " and "ann@example.com" are
// one address -- the table stores exactly this form.
export function normaliseWaitlistEmail(raw: unknown): WaitlistEmail {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!email) return { email: null, error: "Enter your email address." };
  if (email.length > WAITLIST_EMAIL_MAX || !EMAIL_SHAPE.test(email)) {
    return { email: null, error: "That doesn't look like an email address. Check for a typo." };
  }
  return { email, error: null };
}
