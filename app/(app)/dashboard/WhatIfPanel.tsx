"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToday } from "@/components/TodayProvider";
import { FIELD_CLASS } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { RollingFigure } from "@/components/ui/RollingFigure";
import { useValueChange } from "@/components/ui/useValueChange";
import { addDaysISO, parseLocalDate } from "@/lib/date";
import { formatCurrency, formatDateWithWeekday } from "@/lib/format";
import { whatIfView, type WhatIfView } from "@/lib/runway";
import { parseAmountToCents, type WhatIfAnswer } from "@/lib/whatIf";
import { requestAddForm, whatIfPrefill } from "@/lib/quickAdd/openAddForm";

// "Can I afford it?" (docs/Decide-and-Grow.md, F2). Asking never writes:
// the answer comes from POST /dashboard/what-if, which projects and returns.
// The amount travels in the body, never a URL. A newer question aborts the
// one in flight, and questions go out at most four times a second.
//
// "Log it" opens the ordinary add form, filled in; "Just looking" closes
// and leaves no trace.

const DEBOUNCE_MS = 250;
const WEEKDAY_CHIPS = 6;
const weekdayShort = new Intl.DateTimeFormat("en-US", { weekday: "short" });

type Asked = { cents: number; date: string };
type State =
  | { status: "idle" }
  | { status: "loading"; previous: { view: WhatIfView; asked: Asked } | null }
  | { status: "done"; view: WhatIfView; asked: Asked }
  | { status: "error"; message: string };

export function WhatIfPanel({
  heroFigure,
  horizonEnd,
  onDone,
  onHandOff,
  autoFocus = false,
}: {
  /** The hero's figure as it stands -- where the answer rolls from. */
  heroFigure: number;
  horizonEnd: string;
  /** "Just looking": the question closes and leaves no trace. */
  onDone: () => void;
  /**
   * "Log it": everything modal must be gone before the add form opens, or
   * the form sits underneath it.
   */
  onHandOff: () => void;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const today = useToday();
  const amountId = useId();
  const pickId = useId();
  const answerId = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const [amountText, setAmountText] = useState("");
  const [choice, setChoice] = useState<string>("today");
  const [picked, setPicked] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });

  // The chips: today, then each following day while it's inside the horizon.
  const chips = [today];
  for (let k = 1; k <= WEEKDAY_CHIPS; k++) {
    const d = addDaysISO(today, k);
    if (d > horizonEnd) break;
    chips.push(d);
  }

  useEffect(() => {
    if (autoFocus) amountRef.current?.focus();
  }, [autoFocus]);

  // Leaving drops anything still waiting or in flight.
  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  function dateFor(c: string, p: string): string | null {
    if (c === "pick") return p || null;
    return c === "today" ? today : c;
  }

  function ask(text: string, c: string, p: string) {
    clearTimeout(timerRef.current);
    abortRef.current?.abort();
    abortRef.current = null;
    const cents = parseAmountToCents(text);
    const date = dateFor(c, p);
    if (cents === null || cents === 0 || date === null) {
      setState({ status: "idle" });
      return;
    }
    setState((s) => ({
      status: "loading",
      previous: s.status === "done" ? { view: s.view, asked: s.asked } : s.status === "loading" ? s.previous : null,
    }));
    timerRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      fetch("/dashboard/what-if", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cents, date }),
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          const answer = (await res.json()) as WhatIfAnswer;
          if (controller.signal.aborted) return;
          setState({ status: "done", view: whatIfView(answer, cents, date, today), asked: { cents, date } });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
          setState({ status: "error", message: "Sorrel couldn't check that just now. Try again in a moment." });
        });
    }, DEBOUNCE_MS);
  }

  const shown = state.status === "done" ? state : state.status === "loading" ? state.previous : null;
  const figure = shown?.view.kind === "figure" ? shown.view.safeToSpend : heroFigure;
  const change = useValueChange(figure);
  const previousFigure = change.previous === null ? null : formatCurrency(change.previous);

  function logIt() {
    if (!shown) return;
    const prefill = whatIfPrefill(shown.asked.cents, shown.asked.date);
    onHandOff();
    // The quick-add bar owns the add form on the dashboard. If it isn't
    // there, the Transactions page's own form is the normal path.
    if (!requestAddForm(prefill)) router.push("/transactions");
  }

  function justLooking() {
    clearTimeout(timerRef.current);
    abortRef.current?.abort();
    onDone();
  }

  return (
    <section aria-labelledby={`${answerId}-h`} className="flex flex-col gap-4">
      <h3 id={`${answerId}-h`} className="text-sm font-medium text-ink">
        What if…
      </h3>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={amountId} className="text-sm text-ink-secondary">
          Amount
        </label>
        <div className="relative">
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-muted">
            $
          </span>
          <input
            ref={amountRef}
            data-whatif-amount=""
            id={amountId}
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            onChange={(e) => {
              setAmountText(e.target.value);
              ask(e.target.value, choice, picked);
            }}
            className={`${FIELD_CLASS} pl-7 tabular-nums`}
            placeholder="0.00"
            aria-describedby={answerId}
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm text-ink-secondary">When</legend>
        <div className="flex flex-wrap gap-2">
          {chips.map((d) => {
            const value = d === today ? "today" : d;
            return (
              <Chip
                key={d}
                name={answerId}
                value={value}
                checked={choice === value}
                label={d === today ? "Today" : weekdayShort.format(parseLocalDate(d))}
                accessibleLabel={d === today ? "Today" : formatDateWithWeekday(d)}
                onChange={() => {
                  setChoice(value);
                  ask(amountText, value, picked);
                }}
              />
            );
          })}
          <Chip
            name={answerId}
            value="pick"
            checked={choice === "pick"}
            label="Pick a date"
            onChange={() => {
              setChoice("pick");
              ask(amountText, "pick", picked);
            }}
          />
        </div>
        {choice === "pick" ? (
          <div className="mt-1 flex flex-col gap-1.5">
            <label htmlFor={pickId} className="text-xs text-ink-muted">
              Any day through {formatDateWithWeekday(horizonEnd)}
            </label>
            <input
              id={pickId}
              type="date"
              min={today}
              max={horizonEnd}
              value={picked}
              onChange={(e) => {
                setPicked(e.target.value);
                ask(amountText, "pick", e.target.value);
              }}
              className={`${FIELD_CLASS} max-w-[12rem]`}
            />
          </div>
        ) : null}
      </fieldset>

      <div
        className={`rounded-xl border border-hairline bg-surface-raised p-4 transition-opacity duration-150 ${
          state.status === "loading" ? "opacity-60" : ""
        }`}
      >
        <p className="text-xs text-ink-muted">Safe to spend</p>
        {/* The sentence below is what's announced; the rolling figure is for the eye. */}
        <span aria-hidden="true" className="mt-0.5 block text-3xl font-medium text-ink">
          <RollingFigure text={formatCurrency(figure)} previousText={previousFigure} change={change} glow={false} />
        </span>
        <div id={answerId} aria-live="polite" aria-atomic="true" className="mt-2 text-sm text-ink-secondary">
          {state.status === "error" ? (
            <p>{state.message}</p>
          ) : shown ? (
            <>
              <p>{shown.view.line}</p>
              {shown.view.kind === "figure" && shown.view.tightest ? <p className="mt-1">{shown.view.tightest}</p> : null}
            </>
          ) : (
            <p className="text-ink-muted">Enter an amount and a day. Asking doesn&apos;t save anything.</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={logIt} disabled={!shown}>
          Log it
        </Button>
        <button
          type="button"
          onClick={justLooking}
          className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Just looking
        </button>
      </div>
    </section>
  );
}

// A day chip: a real radio, so arrow keys and screen readers work as a group.
// Selection shows as a ring, 160ms on the signature curve.
function Chip({
  name,
  value,
  checked,
  label,
  accessibleLabel,
  onChange,
}: {
  name: string;
  value: string;
  checked: boolean;
  label: string;
  accessibleLabel?: string;
  onChange: () => void;
}) {
  return (
    <label
      className={`whatif-chip inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-action has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-surface ${
        checked
          ? "border-action bg-surface-raised text-ink shadow-[0_0_0_1px_var(--action)]"
          : "border-field-border text-ink-secondary hover:text-ink"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        aria-label={accessibleLabel}
        className="sr-only"
      />
      {label}
    </label>
  );
}
