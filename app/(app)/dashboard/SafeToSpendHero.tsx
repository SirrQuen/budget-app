"use client";

import { useId, useState } from "react";
import type { SafeToSpend } from "@/lib/db/dashboard";
import { Amount } from "@/components/ui/Amount";
import { formatCurrency } from "@/lib/format";
import { ChevronDownIcon } from "@/components/ui/icons";

// The one hero figure on the dashboard (design language: >=48px, exactly one
// per view, proportional figures, same sans as everything else). It renders
// through <Amount>, so a positive result reads "good" and a negative one
// stays plain neutral ink -- never critical red, never a warning icon.
export function SafeToSpendHero({ data }: { data: SafeToSpend }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const short = data.safeToSpend < 0;

  const subline =
    data.perDay !== null
      ? `${formatCurrency(data.perDay)} a day for the ${data.daysRemaining} day${
          data.daysRemaining === 1 ? "" : "s"
        } left this month`
      : `You're ${formatCurrency(Math.abs(data.safeToSpend))} short of your commitments this month`;

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
          <p className="text-sm font-medium text-ink-secondary">Safe to spend</p>
          <Amount
            amount={data.safeToSpend}
            type={short ? "Expense" : "Income"}
            className="mt-1 block text-5xl"
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
              <dt className="text-ink-secondary">Cash on hand</dt>
              <dd className="font-medium text-ink">{formatCurrency(data.cashOnHand)}</dd>
            </div>

            {data.commitments.length > 0 ? (
              data.commitments.map((c) => (
                <div key={c.recurringId} className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-secondary">{c.name}</dt>
                  <dd>
                    <Amount amount={c.amount} type="Expense" />
                  </dd>
                </div>
              ))
            ) : (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-ink-secondary">No recurring commitments left this month</dt>
                <dd className="font-medium text-ink">{formatCurrency(0)}</dd>
              </div>
            )}

            <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-hairline pt-2">
              <dt className="font-medium text-ink">Safe to spend</dt>
              <dd className="font-semibold text-ink">{formatCurrency(data.safeToSpend)}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
