import { daysBetweenInclusive } from "@/lib/date";

// "Last logged 12 days ago" -- when the person last logged something on an
// account (created_at, migration 64), as a fact. Never "you haven't logged
// anything in 12 days": that's a scolding, and the difference is the whole
// tone rule. No threshold changes the wording or the colour.

export function lastLoggedLabel(lastLoggedOn: string | null, today: string): string {
  if (lastLoggedOn === null) return "Nothing logged yet";
  // A clock or zone quirk can put it a day ahead; it was still today.
  const days = Math.max(0, daysBetweenInclusive(lastLoggedOn, today) - 1);
  if (days === 0) return "Last logged today";
  if (days === 1) return "Last logged yesterday";
  return `Last logged ${days} days ago`;
}
