"use client";

import { ConfirmVariableAmountSheet, type VariableAmountTarget } from "../recurring/ConfirmVariableAmountSheet";

// One calm line per card statement waiting on the user's amount -- not a
// modal, not a badge (CLAUDE.md "Prompt timing"). Entering it revises the
// expected payment; it writes no transaction. No dismiss control: it
// disappears the moment it's entered, since confirming revalidates
// /dashboard and this schedule then falls outside the render below's
// statement-window filter (see page.tsx).
export function VariableAmountPrompt({ items }: { items: VariableAmountTarget[] }) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <ConfirmVariableAmountSheet
          key={item.id}
          target={item}
          trigger={(open) => (
            <button
              type="button"
              onClick={open}
              className="w-full rounded-xl border border-hairline bg-surface px-4 py-3 text-left text-sm text-ink-secondary transition-colors duration-150 hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              {item.cardName}&rsquo;s statement is out -- enter this month&rsquo;s payment amount.
            </button>
          )}
        />
      ))}
    </div>
  );
}
