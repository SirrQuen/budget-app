// Where the quick-add bar shows: an ALLOWLIST of the screens about
// transactions themselves -- the dashboard, the transaction list, and
// accounts. Everywhere else, including any screen added later, it doesn't
// show until someone decides it belongs here.
//
// It used to be everywhere except a growing list of exclusions: Recurring
// and Goals went first, then Categories and Settings. A control that logs
// a one-off transaction on a page about something else -- schedules,
// targets, planned amounts versus spending (Budgets), configuration -- is
// a category error, and an exclusion list guarantees the next new screen
// gets it until someone notices (docs/Budgets-Reminders-and-Pending.md,
// item 6). Sub-pages follow their screen.

const WITH_QUICK_ADD = ["/dashboard", "/transactions", "/accounts"] as const;

export function showsQuickAdd(pathname: string): boolean {
  return WITH_QUICK_ADD.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
