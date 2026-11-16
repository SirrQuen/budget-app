import { formatDate, formatDateShort } from "@/lib/format";

// "Imported through Nov 8" -- the latest TRANSACTION date among an account's
// imported rows, so it answers which bank dates are covered (docs/Import-CSV.md,
// "Recent activity, not statements"). A fact, never a nudge: no threshold
// changes the wording, and nothing here chases anyone to import.

/** "Nov 8", or "Nov 8, 2025" when the year isn't the current one. */
export function importedThroughDate(date: string, today: string): string {
  return date.slice(0, 4) === today.slice(0, 4) ? formatDateShort(date) : formatDate(date);
}

/** The account page's line, or null for an account never imported into. */
export function importedThroughLabel(date: string | null, today: string): string | null {
  return date === null ? null : `Imported through ${importedThroughDate(date, today)}`;
}

/** The import flow's line once an account is chosen, or null. */
export function importedThroughSentence(accountName: string, date: string | null, today: string): string | null {
  if (date === null) return null;
  return `Your last import for ${accountName} ran through ${importedThroughDate(date, today)}. Downloading from a few days before that is fine.`;
}
