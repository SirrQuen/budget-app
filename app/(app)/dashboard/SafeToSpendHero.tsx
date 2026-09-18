"use client";

import Link from "next/link";
import { useId, useState } from "react";
import type { SafeToSpend, SafeToSpendWindowReason } from "@/lib/db/dashboard";
import { Amount } from "@/components/ui/Amount";
import { useCountUp } from "@/components/ui/useCountUp";
import {
  formatCurrency,
  formatDateShort,
  formatDateWithWeekday,
  formatDayMonth,
} from "@/lib/format";
import { ChevronDownIcon, InfoIcon, PlusIcon } from "@/components/ui/icons";

// The task's own two examples: a real payday gets the weekday ("Friday 3
// October" -- a date worth checking against your own bank), the
// end-of-month fallback doesn't ("30 September" -- not a date tied to
// anything). next_30_days gets the same weekday treatment as a payday,
// same reasoning -- it's a specific day, not a boundary.
function windowTitle(window: SafeToSpend["window"]): string {
  if (window.reason === "end_of_month") {
    return `Safe to spend through ${formatDayMonth(window.end)}`;
  }
  return `Safe to spend through ${formatDateWithWeekday(window.end)}`;
}

const WINDOW_REASON_SUFFIX: Record<SafeToSpendWindowReason, string | null> = {
  next_payday: "your next payday",
  end_of_month: null,
  next_30_days: "the next 30 days",
};

// The one hero figure on the dashboard (design language: >=48px, exactly one
// per view, proportional figures, same sans as everything else). It renders
// through <Amount>, so a positive result reads "good" and a negative one
// stays plain neutral ink -- never critical red, never a warning icon.
export function SafeToSpendHero({ data }: { data: SafeToSpend }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const short = data.safeToSpend < 0;
  // The hero figure counts up on load (tabular-nums while it moves,
  // proportional at rest); reduced motion lands it instantly. `type` tracks
  // the real value's sign so the tone doesn't flicker mid-count.
  const { display, animating } = useCountUp(data.safeToSpend, "safe-to-spend");

  const suffix = WINDOW_REASON_SUFFIX[data.window.reason];
  const title = suffix ? `${windowTitle(data.window)} — ${suffix}` : windowTitle(data.window);

  const subline =
    data.perDay !== null
      ? `${formatCurrency(data.perDay)} a day for the ${data.daysRemaining} day${
          data.daysRemaining === 1 ? "" : "s"
        } left`
      : `You have ${formatCurrency(Math.abs(data.safeToSpend))} less than what's still due`;

  return (
    <div className="rounded-2xl border border-hairline bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-start justify-between gap-3 rounded-2xl p-5 text-left transition-colors duration-150 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <div>
          <p className="text-sm font-medium text-ink-secondary">{title}</p>
          <Amount
            amount={display}
            type={short ? "Expense" : "Income"}
            className={`mt-1 block text-5xl ${animating ? "tabular-nums" : ""}`}
          />
          <p className="mt-2 text-sm text-ink-secondary">{subline}</p>
        </div>
        <ChevronDownIcon
          aria-hidden="true"
          className={`mt-1 h-5 w-5 shrink-0 text-ink-muted motion-safe:transition-transform motion-safe:duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open ? (
        <div id={panelId} className="border-t border-hairline px-5 py-4">
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-secondary">Spendable cash</dt>
              <dd className="font-medium text-ink">{formatCurrency(data.cashOnHand)}</dd>
            </div>

            {data.commitments.length > 0 ? (
              data.commitments.map((c) => (
                <div key={c.recurringId} className="flex items-baseline justify-between gap-4">
                  <dt className="min-w-0 truncate text-ink-secondary">
                    {c.name} <span className="text-ink-muted">· {formatDateShort(c.dueDate)}</span>
                    {c.isEstimate ? (
                      <span className="ml-1.5 inline-flex items-center gap-1 text-xs text-ink-muted">
                        <InfoIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                        estimate
                      </span>
                    ) : null}
                  </dt>
                  <dd className="shrink-0">
                    <Amount amount={c.amount} type="Expense" />
                  </dd>
                </div>
              ))
            ) : (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-ink-secondary">No recurring commitments due in this window</dt>
                <dd className="font-medium text-ink">{formatCurrency(0)}</dd>
              </div>
            )}

            <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-hairline pt-2">
              <dt className="font-medium text-ink">Safe to spend</dt>
              <dd className="font-semibold text-ink">{formatCurrency(data.safeToSpend)}</dd>
            </div>
          </dl>

          {/* Expected income is context, never arithmetic -- it sits below
              the total in its own visually separated row rather than
              inside the dl above, so it never reads as something already
              subtracted or added. */}
          {data.nextIncome ? (
            <p className="mt-3 border-t border-hairline pt-3 text-xs text-ink-muted">
              Expected: {formatCurrency(data.nextIncome.amount)}
              {data.nextIncome.isEstimate ? " (estimate)" : ""} from {data.nextIncome.name} on{" "}
              {formatDateShort(data.nextIncome.date)} — not counted above.
            </p>
          ) : (
            <Link
              href="/recurring"
              className="mt-3 flex items-center gap-1.5 border-t border-hairline pt-3 text-xs text-ink-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <PlusIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
              Add a paycheck to see your next payday here
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
}
