"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { SafeToSpend } from "@/lib/db/dashboard";
import { formatCurrency, formatDateWithWeekday } from "@/lib/format";
import { itemHref, lowPointFigure, lowestPointLabel, runwayCalculation } from "@/lib/runway";
import { cautionLine } from "@/lib/whatsAhead";
import { AmountBasisTag } from "@/components/AmountBasisTag";
import { LeafIcon } from "@/components/ui/LeafIcon";
import { prefersReducedMotion } from "@/components/ui/useReducedMotion";
import { RunwayChart } from "./RunwayChart";
import { WhatIfPanel } from "./WhatIfPanel";

// The runway (docs/Decide-and-Grow.md, F1), opened from the hero. It draws
// the hero's own projection -- the same object, passed down, never fetched
// again -- so its lowest point, cushion and goal figures are the hero's.
//
// Draws in once per session (sessionStorage, inside try/catch), then is
// still. Reduced motion: drawn already.

const DRAWN_KEY = "sorrel_runway_drawn";

function drawnThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(DRAWN_KEY) === "1";
  } catch {
    return true; // Storage blocked: never animate rather than animate every time.
  }
}

function markDrawn() {
  try {
    window.sessionStorage.setItem(DRAWN_KEY, "1");
  } catch {
    // Nothing to keep.
  }
}

const textButton =
  "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

export function RunwayDialog({
  data,
  startWith,
  onClose,
}: {
  data: SafeToSpend;
  /** "whatif" opens with the question already asked for. */
  startWith: "runway" | "whatif";
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const labelId = useId();
  const tableId = useId();
  const [view, setView] = useState<"chart" | "list">("chart");
  const [whatIfOpen, setWhatIfOpen] = useState(startWith === "whatif");
  // Mounted only once someone opens it, so this runs in the browser.
  const [reveal] = useState(() => !prefersReducedMotion() && !drawnThisSession());

  useEffect(() => {
    markDrawn();
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      // showModal moves focus to the first control (Close); opened for the
      // question, it belongs in the amount instead. This effect runs after
      // the panel's own, so it has the last word.
      if (startWith === "whatif") dialog.querySelector<HTMLInputElement>("[data-whatif-amount]")?.focus();
    }
    // Opens once, on mount; startWith is fixed for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function close() {
    ref.current?.close();
    onClose();
  }

  const caution = cautionLine(data.cautious);
  const points = data.daily.filter((d) => d.out.length > 0 || d.income.length > 0 || d.date === data.trough.date);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={(e) => {
        // Trapped: Tab wraps inside the dialog (MonthRecap's rule).
        if (e.key !== "Tab") return;
        const focusable = [
          ...e.currentTarget.querySelectorAll<HTMLElement>(
            "button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])",
          ),
        ].filter((el) => el.getClientRects().length > 0 || el instanceof SVGElement);
        const first = focusable[0];
        const lastEl = focusable[focusable.length - 1];
        if (!first || !lastEl) return;
        if (e.shiftKey && (document.activeElement === first || !e.currentTarget.contains(document.activeElement))) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          first.focus();
        }
      }}
      className="mx-auto my-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-hairline bg-surface p-0 text-ink backdrop:bg-scrim"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={labelId} className="text-base font-semibold text-ink">
              Your runway
            </h2>
            <p className="mt-0.5 text-sm text-ink-secondary">
              Checking and cash, today through {formatDateWithWeekday(data.horizonEnd)}. A forecast from your schedules and
              anything dated ahead.
            </p>
          </div>
          <button type="button" onClick={close} className={textButton}>
            Close
          </button>
        </div>

        {/* The calculation in one line -- the projection's own figures. */}
        <p className="text-sm text-ink">{runwayCalculation(data)}</p>

        <p className="flex items-start gap-2 text-sm text-ink-secondary">
          <LeafIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink" />
          <span>{lowestPointLabel(data)}</span>
        </p>

        {view === "chart" ? (
          <RunwayChart data={data} reveal={reveal} />
        ) : (
          <RunwayTable data={data} points={points} tableId={tableId} />
        )}

        {caution ? <p className="text-xs text-ink-muted">{caution}</p> : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
          <button
            type="button"
            onClick={() => setView((v) => (v === "chart" ? "list" : "chart"))}
            className={textButton}
          >
            {view === "chart" ? "View as list" : "View as chart"}
          </button>
          {!whatIfOpen ? (
            <button type="button" onClick={() => setWhatIfOpen(true)} className={textButton}>
              What if…
            </button>
          ) : null}
        </div>

        {whatIfOpen ? (
          <div className="border-t border-hairline pt-4">
            <WhatIfPanel
              heroFigure={data.safeToSpend}
              horizonEnd={data.horizonEnd}
              autoFocus
              onDone={() => {
                // Opened for the question alone: done means done. Asked from
                // inside the runway: back to the runway.
                if (startWith === "whatif") close();
                else setWhatIfOpen(false);
              }}
              // "Log it" closes the runway too: the add form opens on the page.
              onHandOff={close}
            />
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

// "View as list": the chart's points as a table -- each payday, each bill
// day and the lowest point, with every item a door.
function RunwayTable({
  data,
  points,
  tableId,
}: {
  data: SafeToSpend;
  points: SafeToSpend["daily"];
  tableId: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table id={tableId} className="w-full text-left text-sm">
        <caption className="sr-only">Your spendable balance on each day something happens</caption>
        <thead>
          <tr className="border-b border-hairline text-xs text-ink-muted">
            <th scope="col" className="py-2 pr-3 font-medium">Day</th>
            <th scope="col" className="py-2 pr-3 font-medium">What happens</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Lowest</th>
            <th scope="col" className="py-2 text-right font-medium">End of day</th>
          </tr>
        </thead>
        <tbody>
          {points.map((d) => (
            <tr key={d.date} className="border-b border-hairline align-top last:border-0">
              <th scope="row" className="py-2 pr-3 font-normal text-ink-secondary">
                {formatDateWithWeekday(d.date)}
                {d.date === data.trough.date ? (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-ink">
                    <LeafIcon className="h-3 w-3" /> your lowest point
                  </span>
                ) : null}
              </th>
              <td className="py-2 pr-3">
                <ul className="flex flex-col gap-1">
                  {d.out.map((o, k) => (
                    <li key={`o${k}`}>
                      <Link href={itemHref(o)} className="rounded text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action">
                        {o.name}
                      </Link>{" "}
                      <span className="tabular-nums text-ink-secondary">{formatCurrency(o.amount)} out</span>{" "}
                      <AmountBasisTag basis={o.basis} />
                    </li>
                  ))}
                  {d.income.map((i, k) => (
                    <li key={`i${k}`}>
                      <Link href={itemHref(i)} className="rounded text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action">
                        {i.name}
                      </Link>{" "}
                      <span className="tabular-nums text-ink-secondary">{formatCurrency(i.amount)} in</span>{" "}
                      <AmountBasisTag basis={i.basis} />
                    </li>
                  ))}
                  {d.out.length === 0 && d.income.length === 0 ? <li className="text-ink-muted">Nothing comes out</li> : null}
                </ul>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-ink">{lowPointFigure(d.low)}</td>
              <td className="py-2 text-right tabular-nums text-ink">{lowPointFigure(d.end)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
