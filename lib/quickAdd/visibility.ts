// Where the quick-add bar shows. Everywhere in the app except the two
// screens about something other than transactions: Recurring (schedules)
// and Goals. A control that creates a one-off transaction on a page about
// schedules is a category error (docs/Recurring-Amounts-and-Transfer-
// Editing.md, 3). Their sub-pages follow them.

const WITHOUT_QUICK_ADD = ["/recurring", "/goals"] as const;

export function showsQuickAdd(pathname: string): boolean {
  return !WITHOUT_QUICK_ADD.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
