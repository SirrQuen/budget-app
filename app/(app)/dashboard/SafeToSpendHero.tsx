"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type {
  SafeToSpend,
  SafeToSpendCommitment,
  SafeToSpendWindowReason,
} from "@/lib/db/dashboard";
import type { OverdueOccurrence } from "@/lib/safeToSpendProjection";
import { occurrenceKey } from "@/lib/upcomingOccurrences";
import { UnconfirmedIncomeNote, UnconfirmedObligationNote } from "./UnconfirmedIncomeNote";
import type { HorizonReason } from "@/lib/safeToSpendProjection";
import { toneClassName } from "@/components/ui/Amount";
import { RollingFigure } from "@/components/ui/RollingFigure";
import { useValueChange } from "@/components/ui/useValueChange";
import { cautionLine, whatsAhead, whyThisNumber } from "@/lib/whatsAhead";
import {
  formatCurrency,
  formatSignedAmount,
  formatDateShort,
  formatDateWithWeekday,
  formatDayMonth,
} from "@/lib/format";
import { ChevronDownIcon, PlusIcon } from "@/components/ui/icons";
import { AmountBasisTag } from "@/components/AmountBasisTag";
import { RunwayDialog } from "./RunwayDialog";
import { OPEN_RUNWAY_EVENT, type OpenRunwayDetail } from "@/lib/runwayRequest";

const heroLink =
  "inline-flex min-h-11 items-center rounded-full px-2 text-sm font-medium text-ink-secondary underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

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
      : (data.paycheck === "untracked" ? WINDOW_SUFFIX_UNTRACKED : WINDOW_SUFFIX)[
          data.windowReason ?? "end_of_month"
        ];
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

// A paycheck exists but pays outside the spendable set (into Savings,
// say). Saying "no paycheck" would be false; this names where it goes.
const WINDOW_SUFFIX_UNTRACKED: Record<SafeToSpendWindowReason, string> = {
  next_payday: "your paycheck lands outside checking and cash",
  end_of_month: "your paycheck lands outside checking and cash",
  next_30_days: "the next 30 days, your paycheck lands outside checking and cash",
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

// "Every number is a door": an item in the breakdown opens what it is -- its
// schedule on the recurring page, or the one-off transaction itself.
function sourceHref(c: SafeToSpendCommitment): string {
  return c.recurringId !== null ? `/recurring#schedule-${c.recurringId}` : `/transactions/${c.transactionId}/edit`;
}

function ObligationRow({ c, indent = false }: { c: SafeToSpendCommitment; indent?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${indent ? "pl-4 text-xs" : ""}`}>
      <dt className="min-w-0 break-words text-ink-secondary sm:truncate">
        <Link href={sourceHref(c)} className="rounded underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
          {c.name}
        </Link>{" "}
        <span className="text-ink-muted">· {formatDateShort(c.date)}</span>{" "}
        <AmountBasisTag basis={c.basis} />
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

// A bill past its due date that nobody has confirmed -- still subtracted
// today, so the figure has a findable cause. Answered in the queue.
function UnconfirmedObligationLine({ item }: { item: OverdueOccurrence }) {
  return (
    <li className="text-xs text-ink-secondary">
      <UnconfirmedObligationNote item={item} />
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

// The hero as text: positive reads as income ("+$1,240.00"), zero as a plain
// "$0.00" -- a trough below zero never turns red or grows a warning icon.
function figureText(value: number): string {
  return value > 0 ? formatSignedAmount(value, "Income").text : formatCurrency(0);
}

// The one hero figure on the dashboard (design language: >=48px, exactly one
// per view, proportional figures, same sans as everything else). Positive
// renders through <Amount> as income-toned; $0 is plain ink -- a trough
// below zero never turns red or grows a warning icon.
export function SafeToSpendHero({ data }: { data: SafeToSpend }) {
  const [open, setOpen] = useState(false);
  // The runway (F1) or the question alone (F2). Mounted only while open.
  const [runway, setRunway] = useState<"runway" | "whatif" | null>(null);
  const panelId = useId();

  // Asked from the What's new card (lib/runwayRequest.ts): the same runway
  // the "See your runway" button opens.
  useEffect(() => {
    const onOpen = (event: Event) => {
      (event as CustomEvent<OpenRunwayDetail>).detail.handled = true;
      setRunway("runway");
    };
    window.addEventListener(OPEN_RUNWAY_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_RUNWAY_EVENT, onOpen);
  }, []);

  // The figure rolls only when it CHANGES while on screen (a paycheck
  // confirmed, an expense added): up for a rise, with a glow behind it; down
  // for a fall, with nothing. On load it is still. The rolling digits are
  // aria-hidden and the real figure sits in a polite live region
  // (RollingFigure). docs/Motion-and-Delight.md, step 2.
  const change = useValueChange(data.safeToSpend);
  const figure = figureText(data.safeToSpend);
  const previousFigure = change.previous === null ? null : figureText(change.previous);
  const figureClass = `mt-1 block text-5xl ${data.safeToSpend > 0 ? "font-medium " + toneClassName("good") : "font-medium text-ink"}`;

  const projection = data.mode === "projection";
  const why = whyThisNumber(data);

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
          <span className={figureClass}>
            <RollingFigure text={figure} previousText={previousFigure} change={change} />
          </span>
          <p className="mt-2 text-sm text-ink-secondary">{subline(data)}</p>
          {/* The cause sits with the number (docs/Safe-to-Spend-Why.md): a
              figure on its own reads as a verdict. Inside the button, so
              it's part of the card's accessible name. */}
          <p className="mt-1 text-xs text-ink-muted">{why.cause}</p>
        </div>
        <ChevronDownIcon
          aria-hidden="true"
          className={`mt-1 h-5 w-5 shrink-0 text-ink-muted motion-safe:transition-transform motion-safe:duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* The runway and "What if I spend…" (docs/Decide-and-Grow.md, F1 and F2):
          the figure drawn day by day, and the question asked against it.
          Siblings of the card's button, never inside it. */}
      <div className="-mt-2 flex flex-wrap gap-1 px-3 pb-3">
        <button type="button" onClick={() => setRunway("runway")} className={heroLink}>
          See your runway
        </button>
        <button type="button" onClick={() => setRunway("whatif")} className={heroLink}>
          What if I spend…
        </button>
      </div>
      {runway ? <RunwayDialog data={data} startWith={runway} onClose={() => setRunway(null)} /> : null}

      {/* No usable paycheck: the one prompt to fix that, visible without
          opening the breakdown. A paycheck paying outside the set needs
          pointing at checking or cash, not adding. */}
      {!projection && !data.nextIncome ? (
        <Link
          href="/recurring"
          className="mx-5 mb-4 flex w-fit items-center gap-1.5 rounded text-xs text-ink-muted transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {data.paycheck === "untracked" ? (
            "Point your paycheck at checking or cash to see further ahead"
          ) : (
            <>
              <PlusIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
              Add a paycheck to see further ahead
            </>
          )}
        </Link>
      ) : null}

      {open ? (
        <div id={panelId} className="border-t border-hairline px-5 py-4">
          {/* Anything quietly moving the figure goes first, so the cause of
              a surprising number is the first thing read. */}
          {data.unconfirmedIncome.length > 0 || data.overdueObligations.length > 0 ? (
            <ul className="mb-3 flex flex-col gap-2 border-b border-hairline pb-3">
              {data.unconfirmedIncome.map((item) => (
                <UnconfirmedIncomeLine key={item.recurringId} item={item} />
              ))}
              {data.overdueObligations.map((item) => (
                <UnconfirmedObligationLine key={item.recurringId} item={item} />
              ))}
            </ul>
          ) : null}

          {/* What follows from the cause on the card: what will and won't
              move the figure. None at $0 -- nothing lowers it further. */}
          {why.consequence ? <p className="mb-3 text-sm text-ink-secondary">{why.consequence}</p> : null}

          {/* Label and value, unsigned throughout -- every line goes
              through formatCurrency, never the signed <Amount>, so a
              subtracted line doesn't read "−$300.00" beside "$2,400.00". */}
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-secondary">Cash on hand</dt>
              <dd className="font-medium tabular-nums text-ink">{formatCurrency(data.cashOnHand)}</dd>
            </div>
            {/* Where cash on hand comes from, and what it leaves out -- a
                figure that excludes someone's savings has to say so, or it
                reads as wrong. Facts only, in ink. */}
            {data.drawnFrom.map((a) => (
              <div key={a.id} className="flex items-baseline justify-between gap-4 pl-4 text-xs">
                <dt className="min-w-0 break-words text-ink-secondary sm:truncate">
                  <Link href={`/accounts/${a.id}`} className="rounded underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
                    {a.name}
                  </Link>
                </dt>
                <dd className="shrink-0 font-medium tabular-nums text-ink">{formatCurrency(a.balance)}</dd>
              </div>
            ))}
            {data.notCounted.length > 0 ? (
              <div className="flex items-baseline justify-between gap-4 pl-4 text-xs">
                <dt className="shrink-0 text-ink-muted">Not counted</dt>
                <dd className="min-w-0 break-words text-right text-ink-muted">
                  {data.notCounted.map((a, i) => (
                    <span key={a.id}>
                      {i > 0 ? ", " : ""}
                      <Link href={`/accounts/${a.id}`} className="rounded underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
                        {a.name}
                      </Link>
                    </span>
                  ))}
                </dd>
              </div>
            ) : null}

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
                  <ObligationRow key={occurrenceKey(c)} c={c} indent />
                ))}
              </>
            ) : data.obligations.length > 0 ? (
              data.obligations.map((c) => <ObligationRow key={occurrenceKey(c)} c={c} />)
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

            {/* Named beside the cushion: both come off flat. A goal fed by
                recurring transfers holds only what this month's transfers
                don't cover -- those are already commitments above, netted
                in the projection (migration 82). */}
            {data.goalHolds.length > 0 ? (
              <>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-secondary">
                    Goals this month{" "}
                    <Link
                      href="/goals"
                      className="rounded text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
                    >
                      change
                    </Link>
                  </dt>
                  <dd className="shrink-0 font-medium tabular-nums text-ink">{formatCurrency(data.goalHold)}</dd>
                </div>
                {data.goalHolds.map((g) => (
                  <div key={g.goalId} className="flex items-baseline justify-between gap-4 pl-4 text-xs">
                    <dt className="min-w-0 break-words text-ink-muted">Still to set aside for {g.name}</dt>
                    <dd className="shrink-0 tabular-nums text-ink-secondary">{formatCurrency(g.amount)}</dd>
                  </div>
                ))}
              </>
            ) : null}

            <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-hairline pt-2">
              <dt className="font-medium text-ink">Safe to spend</dt>
              <dd className="font-semibold tabular-nums text-ink">{formatCurrency(data.safeToSpend)}</dd>
            </div>
          </dl>

          {cautionLine(data.cautious) ? (
            <p className="mt-2 text-xs text-ink-muted">{cautionLine(data.cautious)}</p>
          ) : null}

          {/* The same figure, drawn day by day (F1). */}
          <button type="button" onClick={() => setRunway("runway")} className={`${heroLink} mt-2 -ml-2`}>
            See your runway
          </button>

          <WhatsAheadBlock data={data} />

          {/* Expected income is context, never part of the breakdown's
              arithmetic -- it sits below the total in its own separated
              row so it never reads as a line that was added or
              subtracted. */}
          {data.nextIncome ? (
            <p className="mt-3 border-t border-hairline pt-3 text-xs text-ink-muted">
              Next paycheck: {formatCurrency(data.nextIncome.amount)}
              {" "}<AmountBasisTag basis={data.nextIncome.basis} /> from {data.nextIncome.name} on{" "}
              {formatDateShort(data.nextIncome.date)}
              {projection ? "." : " — not counted above."}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
