// "Last logged Nov 12" -- when the person last logged something on an
// account (created_at, migration 64), as a fact. Never "you haven't logged
// anything in 12 days": that's a scolding, and the difference is the whole
// tone rule. No threshold changes the wording or the colour.
//
// The ONE formatter for this line: the dashboard's Accounts tile and the
// account page both call it. The date arrives already in the user's zone
// (account_last_logged casts created_at::date inside a request, where the
// apply_user_timezone() hook has set the session TimeZone, migration 40),
// so a late-evening entry is that evening's date. This only formats a
// calendar date; it never converts an instant and never reads a clock.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Nov 12", or "Nov 12, 2025" when the year isn't the user's current one --
 * THE year rule for a calendar date shown as a fact. "Imported through"
 * uses it too (lib/importedThrough.ts); never restate it. A date a day
 * ahead of today (clock or zone quirk) reads as today.
 */
export function calendarDateLabel(date: string, today: string): string {
  const on = date > today ? today : date;
  const [year, month, day] = on.split("-").map(Number);
  const label = `${MONTHS[month - 1]} ${day}`;
  return year === Number(today.slice(0, 4)) ? label : `${label}, ${year}`;
}

export function lastLoggedLabel(lastLoggedOn: string | null, today: string): string {
  if (lastLoggedOn === null) return "Nothing logged yet";
  return `Last logged ${calendarDateLabel(lastLoggedOn, today)}`;
}
