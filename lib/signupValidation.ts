// Signup field rules, shared by the form (inline, on blur) and the signup
// server action (authoritative), so both say the same thing. Pure -- safe
// to import from a Client Component.
//
// Names are deliberately permissive: anything a person might be called is
// accepted -- apostrophes, hyphens, spaces, accents, any script. The only
// rejections are blank, over-length, and control characters (invisible, and
// never part of a name; they only arrive by pasting).

import { clean, nameLength, NAME_MAX, PREFERRED_NAME_MAX } from "@/lib/displayName";

export type SignupField =
  | "email"
  | "firstName"
  | "lastName"
  | "preferredName"
  | "password"
  | "confirmPassword";

export type SignupValues = Record<SignupField, string>;

const CONTROL_CHARS = /\p{Cc}/u;

// A typo catch, not a deliverability check -- Supabase Auth has the final
// word, and the confirmation email proves the address.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(raw: string): string | null {
  const email = clean(raw);
  if (!email) return "Enter your email address.";
  if (!EMAIL_SHAPE.test(email)) return "That doesn't look like an email address. Check for a typo.";
  return null;
}

function validateName(
  raw: string,
  { label, max, required }: { label: string; max: number; required: boolean },
): string | null {
  const name = clean(raw);
  if (!name) {
    return required ? `Enter your ${label}. It's how you'll show up in the app.` : null;
  }
  if (CONTROL_CHARS.test(name)) return `Your ${label} has a hidden character in it. Try retyping it.`;
  if (nameLength(name) > max) return `Keep your ${label} to ${max} characters or fewer.`;
  return null;
}

export const validateFirstName = (raw: string) =>
  validateName(raw, { label: "first name", max: NAME_MAX, required: true });

export const validateLastName = (raw: string) =>
  validateName(raw, { label: "last name", max: NAME_MAX, required: false });

export const validatePreferredName = (raw: string) =>
  validateName(raw, { label: "nickname", max: PREFERRED_NAME_MAX, required: false });

// Mirrors the project's Supabase Auth password policy (Authentication ->
// Policies): minimum length 8, and at least one of each character class
// below. Supabase enforces it regardless; this exists so the requirements
// are on screen before the user types. If the dashboard policy changes,
// change this to match -- a mismatch shows a tick the server then rejects.
export const PASSWORD_MIN = 8;
const PASSWORD_SYMBOLS = /[!@#$%^&*()_+\-=[\]{};'\\:"|<>?,./`~]/;

export const PASSWORD_RULES: ReadonlyArray<{
  id: string;
  label: string;
  missing: string;
  test: (password: string) => boolean;
}> = [
  {
    id: "length",
    label: `${PASSWORD_MIN} or more characters`,
    missing: `${PASSWORD_MIN} or more characters`,
    test: (p) => p.length >= PASSWORD_MIN,
  },
  { id: "upper", label: "An uppercase letter", missing: "an uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { id: "lower", label: "A lowercase letter", missing: "a lowercase letter", test: (p) => /[a-z]/.test(p) },
  { id: "digit", label: "A number", missing: "a number", test: (p) => /[0-9]/.test(p) },
  {
    id: "symbol",
    label: "A symbol, like ! ? # or %",
    missing: "a symbol",
    test: (p) => PASSWORD_SYMBOLS.test(p),
  },
];

export function validatePassword(password: string): string | null {
  if (!password) return "Choose a password.";
  const missing = PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.missing);
  if (missing.length === 0) return null;
  return `Your password still needs ${joinList(missing)}.`;
}

export function validateConfirmPassword(password: string, confirm: string): string | null {
  if (!confirm) return "Type your password again to confirm it.";
  if (confirm !== password) return "These don't match your password yet.";
  return null;
}

/** Every field's error, or null where the field is fine. Order is form order. */
export function validateSignup(values: SignupValues): Record<SignupField, string | null> {
  return {
    email: validateEmail(values.email),
    firstName: validateFirstName(values.firstName),
    lastName: validateLastName(values.lastName),
    preferredName: validatePreferredName(values.preferredName),
    password: validatePassword(values.password),
    confirmPassword: validateConfirmPassword(values.password, values.confirmPassword),
  };
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
