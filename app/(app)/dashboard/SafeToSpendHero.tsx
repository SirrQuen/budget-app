"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import type {
  SafeToSpend,
  SafeToSpendCommitment,
  SafeToSpendOverdueBill,
  SafeToSpendWindowReason,
} from "@/lib/db/dashboard";
import type { OverdueOccurrence } from "@/lib/safeToSpendProjection";
import { resolveOverdueBillAction } from "@/lib/actions/recurring";
import { daysBetweenInclusive } from "@/lib/date";
import { useToday } from "@/components/TodayProvider";
import { ConfirmVariableAmountSheet } from "../recurring/ConfirmVariableAmountSheet";
import { INLINE_ACTION, UnconfirmedIncomeNote } from "./UnconfirmedIncomeNote";
import type { HorizonReason } from "@/lib/safeToSpendProjection";
import { Amount } from "@/components/ui/Amount";
import { useCountUp } from "@/components/ui/useCountUp";
import { whatsAhead } from "@/lib/whatsAhead";
import {
  formatCurrency,
  formatDateShort,
  formatDateWithWeekday,
  formatDayMonth,
} from "@/lib/format";
import { ChevronDownIcon, InfoIcon, PlusIcon } from "@/components/ui/icons";
import { callAction } from "@/components/useActionForm";

// A projection or a real payday gets the weekday ("Friday 3 October" -- a
// date worth checking against your own bank); the end-of-month fallback
// doesn't ("30 September" -- not a date tied to anything).
function title(data: SafeToSpend): string {
  const through =
    data.windowReason === "end_of_month"
      ? formatDayMonth(data.horizonEnd)
      : formatDateWithWeekday(data.horizonEnd);
  const suffix =
    data.mode === "projection"
      ? PROJECTION_SUFFIX[data.horizonReason]
      : WINDOW_SUFFIX[data.windowReason ?? "end_of_month"];
  return `Safe to spend through ${through} — ${suffix}`;
}

const PROJECTION_SUFFIX: Record<HorizonReason, string> = {
  payday_after_next: "your payday after next",
  minimum: "the next five weeks",
  window: "",
};

// Window mode means no usable paycheck -- the label says so rather than
// implying the fallback was a choice.
const WINDOW_SUFFIX: Record<SafeToSpendWindowReason, string> = {
  next_payday: "no paycheck scheduled",
  end_of_month: "no paycheck scheduled",
  next_30_days: "the next 30 days, no paycheck scheduled",
};

function subline(data: SafeToSpend): string {
  if (data.perDay !== null) {
    return `${formatCurrency(data.perDay)} a day for the ${data.daysRemaining} day${
      data.daysRemaining === 1 ? "" : "s"
    } left`;
  }
  if (data.shortfall) {
    return `You're on track to be ${formatCurrency(data.shortfall.amount)} short on ${formatDateWithWeekday(
      data.shortfall.date,
    )}.`;
  }
  return `Your low point of ${formatCurrency(data.trough.amount)} on ${formatDateWithWeekday(
    data.trough.date,
  )} sits inside your ${formatCurrency(data.cushion)} cushion.`;
}

function EstimateTag() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 text-xs text-ink-muted">
      <InfoIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
      estimate
    </span>
  );
}

function ObligationRow({ c, indent = false }: { c: SafeToSpendCommitment; indent?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${indent ? "pl-4 text-xs" : ""}`}>
      <dt className="min-w-0 truncate text-ink-secondary">
        {c.name} <span className="text-ink-muted">· {formatDateShort(c.date)}</span>
        {c.isEstimate ? <EstimateTag /> : null}
      </dt>
      <dd className="shrink-0 font-medium tabular-nums text-ink">{formatCurrency(c.amount)}</dd>
    </div>
  );
}

function UnconfirmedIncomeLine({ item }: { item: OverdueOccurrence }) {
  return (
    <li className="text-xs text-ink-secondary">
      <UnconfirmedIncomeNote item={item} />
    </li>
  );
}

function daysAgo(dateISO: string, today: string): string {
  const days = daysBetweenInclusive(dateISO, today) - 1;
  return days === 1 ? "yesterday" : `${days} days ago`;
}

// A bill past due that never posted -- subtracted today until it's
// answered, so a stale schedule can't quietly hold the figure down.
function OverdueBillLine({ item }: { item: SafeToSpendOverdueBill }) {
  const today = useToday();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const resolve = (outcome: "posted" | "skipped") => {
    setError(null);
    startTransition(async () => {
      const result = await callAction(() => resolveOverdueBillAction(item.recurringId, outcome));
      if (result?.error) setError(result.error);
    });
  };

  return (
    <li className="text-xs text-ink-secondary">
      {item.name} was due {daysAgo(item.dueDate, today)} — did it go out?{" "}
      <span className="inline-flex flex-wrap gap-x-3">
        {item.cardPayment ? (
          <ConfirmVariableAmountSheet
            target={{
              id: item.recurringId,
              cardName: item.cardPayment.cardName,
              estimatedAmount: item.amount,
              statementDay: item.cardPayment.statementDay,
              dueDate: item.cardPayment.runDate,
            }}
            trigger={(open) => (
              <button type="button" onClick={open} className={INLINE_ACTION}>
                Yes, confirm the amount
              </button>
            )}
          />
        ) : (
          <button
            type="button"
            onClick={() => resolve("posted")}
            disabled={pending}
            className={INLINE_ACTION}
          >
            Yes, it went out
          </button>
        )}
        <button
          type="button"
          onClick={() => resolve("skipped")}
          disabled={pending}
          className={INLINE_ACTION}
        >
          No, skip it
        </button>
      </span>
      {error ? <span className="mt-1 block text-ink-muted">{error}</span> : null}
    </li>
  );
}

// Every run below the cushion, in date order. The run holding the low
// point is marked inline rather than repeated -- it and the "Low point"
// line above are one forecast with one number. Ink tokens only: severity
// lives in the wording, never in colour or an icon.
function WhatsAheadBlock({ data }: { data: SafeToSpend }) {
  const headingId = useId();
  const view = whatsAhead(data);
  return (
    <section aria-labelledby={headingId} className="mt-3 border-t border-hairline pt-3">
      <h3 id={headingId} className="text-xs font-medium text-ink-secondary">
        What&apos;s ahead
      </h3>
      {view.kind === "clear" ? (
        <p className="mt-1 text-xs text-ink-muted">{view.line}</p>
      ) : (
        <>
          <ol className="mt-2 flex flex-col gap-2.5">
            {view.items.map((item) => (
              <li key={item.key} className="text-xs">
                <p className="text-ink">
                  <span className="text-ink-muted">{item.when} · </span>
                  {item.headline}
                  {item.isLowestPoint ? <span className="text-ink-muted"> · your lowest point</span> : null}
                </p>
                <p className="mt-0.5 text-ink-secondary">
                  {item.cause} {item.recovery}
                </p>
              </li>
            ))}
          </ol>
          {view.more ? <p className="mt-2 text-xs text-ink-muted">{view.more}</p> : null}
        </>
      )}
    </section>
  );
}

// The one hero figure on the dashboard (design language: >=48px, exactly one
// per view, proportional figures, same sans as everything else). Positive
// renders through <Amount> as income-toned; $0 is plain ink -- a trough
// below zero never turns red or grows a warning icon.
export function SafeToSpendHero({ data }: { data: SafeToSpend }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  // The hero figure counts up on load (tabular-nums while it moves,
  // proportional at rest); reduced motion lands it instantly.
  const { display, animating } = useCountUp(data.safeToSpend, "safe-to-spend");
  const figureClass = `mt-1 block text-5xl ${animating ? "tabular-nums" : ""}`;

  const projection = data.mode === "projection";

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
          <p className="text-sm font-medium text-ink-secondary">{title(data)}</p>
          {data.safeToSpend > 0 ? (
            <Amount amount={display} type="Income" className={figureClass} />
          ) : (
            <span className={`font-medium text-ink ${figureClass}`}>{formatCurrency(0)}</span>
          )}
          <p className="mt-2 text-sm text-ink-secondary">{subline(data)}</p>
        </div>
        <ChevronDownIcon
          aria-hidden="true"
          className={`mt-1 h-5 w-5 shrink-0 text-ink-muted motion-safe:transition-transform motion-safe:duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* No usable paycheck: the one prompt to add one, visible without
          opening the breakdown. */}
      {!projection && !data.nextIncome ? (
        <Link
          href="/recurring"
          className="mx-5 mb-4 flex w-fit items-center gap-1.5 rounded text-xs text-ink-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <PlusIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
          Add a paycheck to see further ahead
        </Link>
      ) : null}

      {open ? (
        <div id={panelId} className="border-t border-hairline px-5 py-4">
          {/* Anything quietly moving the figure goes first, so the cause of
              a surprising number is the first thing read. */}
          {data.unconfirmedIncome.length > 0 || data.overdueBills.length > 0 ? (
            <ul className="mb-3 flex flex-col gap-2 border-b border-hairline pb-3">
              {data.unconfirmedIncome.map((item) => (
                <UnconfirmedIncomeLine key={item.recurringId} item={item} />
              ))}
              {data.overdueBills.map((item) => (
                <OverdueBillLine key={item.recurringId} item={item} />
              ))}
            </ul>
          ) : null}

          {/* Label and value, unsigned throughout -- every line goes
              through formatCurrency, never the signed <Amount>, so a
              subtracted line doesn't read "−$300.00" beside "$2,400.00". */}
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-secondary">Cash on hand</dt>
              <dd className="font-medium tabular-nums text-ink">{formatCurrency(data.cashOnHand)}</dd>
            </div>

            {projection ? (
              <>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-secondary">
                    Low point{" "}
                    <span className="text-ink-muted">· {formatDateWithWeekday(data.trough.date)}</span>
                  </dt>
                  <dd className="font-medium tabular-nums text-ink">
                    {data.trough.amount < 0 ? "−" : ""}
                    {formatCurrency(Math.abs(data.trough.amount))}
                  </dd>
                </div>
                {data.trough.obligations.map((c) => (
                  <ObligationRow key={`${c.recurringId}-${c.dueDate}`} c={c} indent />
                ))}
              </>
            ) : data.obligations.length > 0 ? (
              data.obligations.map((c) => <ObligationRow key={`${c.recurringId}-${c.dueDate}`} c={c} />)
            ) : (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-ink-secondary">No recurring commitments due in this window</dt>
                <dd className="font-medium tabular-nums text-ink">{formatCurrency(0)}</dd>
              </div>
            )}

            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-secondary">
                Cushion{" "}
                <Link
                  href="/settings"
                  className="rounded text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
                >
                  {data.cushionIsDefault ? "suggested · change" : "change"}
                </Link>
              </dt>
              <dd className="shrink-0 font-medium tabular-nums text-ink">{formatCurrency(data.cushion)}</dd>
            </div>

            <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-hairline pt-2">
              <dt className="font-medium text-ink">Safe to spend</dt>
              <dd className="font-semibold tabular-nums text-ink">{formatCurrency(data.safeToSpend)}</dd>
            </div>
          </dl>

          <WhatsAheadBlock data={data} />

          {/* Expected income is context, never part of the breakdown's
              arithmetic -- it sits below the total in its own separated
              row so it never reads as a line that was added or
              subtracted. */}
          {data.nextIncome ? (
            <p className="mt-3 border-t border-hairline pt-3 text-xs text-ink-muted">
              Next paycheck: {formatCurrency(data.nextIncome.amount)}
              {data.nextIncome.isEstimate ? " (estimate)" : ""} from {data.nextIncome.name} on{" "}
              {formatDateShort(data.nextIncome.date)}
              {projection ? "." : " — not counted above."}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
