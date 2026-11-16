import { calendarDateLabel } from "@/lib/lastLogged";

// "Imported through Nov 8" -- the latest TRANSACTION date among an account's
// imported rows, so it answers which bank dates are covered (docs/Import-CSV.md,
// "Recent activity, not statements"). A fact, never a nudge: no threshold
// changes the wording, and nothing here chases anyone to import.

/** The account page's line, or null for an account never imported into. */
export function importedThroughLabel(date: string | null, today: string): string | null {
  return date === null ? null : `Imported through ${calendarDateLabel(date, today)}`;
}

/** The import flow's line once an account is chosen, or null. */
export function importedThroughSentence(accountName: string, date: string | null, today: string): string | null {
  if (date === null) return null;
  return `Your last import for ${accountName} ran through ${calendarDateLabel(date, today)}. Downloading from a few days before that is fine.`;
}
