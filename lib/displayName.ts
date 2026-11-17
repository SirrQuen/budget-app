// The one place a user's name is resolved. Every field is optional and may
// be null, '' or whitespace: profiles.first_name/last_name are NOT NULL but
// land as '' for anyone who never set them, and preferred_name is null
// unless given. Blank means absent at every step.
//
// Neither resolver ever returns the full email address.

import { greetingWithName, type TimeBand } from "@/lib/timeOfDay";

export type NameFields = {
  firstName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
};

// Matches the profiles_preferred_name_length check (migration 34).
export const PREFERRED_NAME_MAX = 30;
// App-side only; first_name/last_name have no length check in the DB.
export const NAME_MAX = 50;

// Code points, not UTF-16 units, so it agrees with Postgres char_length().
export function nameLength(value: string): number {
  return [...value].length;
}

// Trimmed, or null if there's nothing there. Exported so validation and
// storage agree with display on what "blank" means.
export function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Name to address the user by, or null if they haven't given one. */
export function greetingName({ preferredName, firstName }: NameFields): string | null {
  return clean(preferredName) ?? clean(firstName);
}

/** Addressing name with the final fallback, for "Hi there"-style copy. */
export function greetingNameOrThere(fields: NameFields): string {
  return greetingName(fields) ?? "there";
}

/**
 * Who's signed in, for the sidebar: full name -> first -> preferred ->
 * the part of the email before the @ -> "Your account".
 */
export function identityName({
  firstName,
  lastName,
  preferredName,
  email,
}: NameFields & { email?: string | null }): string {
  const first = clean(firstName);
  const last = clean(lastName);
  if (first && last) return `${first} ${last}`;
  if (first) return first;

  const preferred = clean(preferredName);
  if (preferred) return preferred;

  const localPart = clean(email?.split("@")[0]);
  if (localPart) return localPart;

  return "Your account";
}

/**
 * Dashboard greeting. The first session of a sign-in is "Welcome"; after
 * that it is the time-of-day phrase (lib/timeOfDay.ts -- the one greeting
 * source, shared with the sign-in splash). No name resolves -> the bare
 * phrase, never "Welcome, ". No full stop: a greeting isn't a sentence.
 */
export function welcomeMessage(fields: NameFields, isFirstLogin: boolean, band: TimeBand): string {
  const name = greetingName(fields);
  if (isFirstLogin) return name ? `Welcome, ${name}` : "Welcome";
  return greetingWithName(band, name);
}
