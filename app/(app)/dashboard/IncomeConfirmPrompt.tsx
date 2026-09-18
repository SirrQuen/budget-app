"use client";

import { ConfirmIncomeSheet, type IncomeConfirmTarget } from "../recurring/ConfirmIncomeSheet";

// One calm line per Income schedule waiting on confirmation -- not a modal,
// not a badge (same "Prompt timing" treatment as VariableAmountPrompt). No
// dismiss control: it disappears the moment it's confirmed, since
// confirming revalidates /dashboard and this schedule's next_run_date has
// then advanced past today - date_tolerance_days (see page.tsx's filter).
export function IncomeConfirmPrompt({ items }: { items: IncomeConfirmTarget[] }) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <ConfirmIncomeSheet
          key={item.id}
          target={item}
          trigger={(open) => (
            <button
              type="button"
              onClick={open}
              className="w-full rounded-xl border border-hairline bg-surface px-4 py-3 text-left text-sm text-ink-secondary transition-colors duration-150 hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Did your {item.name} paycheck land?
            </button>
          )}
        />
      ))}
    </div>
  );
}
