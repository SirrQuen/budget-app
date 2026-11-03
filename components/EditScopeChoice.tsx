"use client";

import { useState } from "react";
import { defaultEditScope, EDIT_SCOPE_LABELS, type EditScope } from "@/lib/recurringEditScope";

// "Just this one" / "This and future occurrences" -- shown when the amount
// of a transaction confirmed from a schedule has changed
// (lib/recurringEditScope.ts). The default depends on the schedule; the
// choice is always visible, so nothing propagates without the user seeing
// it. Posts as `edit_scope`; the server reads the stored amount itself.
export function EditScopeChoice({
  scheduleName,
  amountIsVariable,
}: {
  scheduleName: string;
  amountIsVariable: boolean;
}) {
  const [scope, setScope] = useState<EditScope>(defaultEditScope(amountIsVariable));

  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-hairline px-3 py-2.5">
      <legend className="px-1 text-sm font-medium text-ink-secondary">Change the {scheduleName} schedule too?</legend>
      <div className="flex flex-wrap gap-1">
        {(Object.keys(EDIT_SCOPE_LABELS) as EditScope[]).map((value) => (
          <label
            key={value}
            className="cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink has-[:checked]:bg-action has-[:checked]:text-action-ink has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-action has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-surface"
          >
            <input
              type="radio"
              name="edit_scope"
              value={value}
              checked={scope === value}
              onChange={() => setScope(value)}
              className="sr-only"
            />
            {EDIT_SCOPE_LABELS[value]}
          </label>
        ))}
      </div>
      <p className="text-xs text-ink-muted">
        {scope === "future"
          ? "Future occurrences expect this amount, and the forecast uses it."
          : "Only this transaction changes. The schedule and the forecast stay as they are."}
      </p>
    </fieldset>
  );
}
