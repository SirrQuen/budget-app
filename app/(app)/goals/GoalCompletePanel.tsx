"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { callAction } from "@/components/useActionForm";
import { redirectScheduleAction, stopScheduleAction } from "@/lib/actions/goals";
import { FIELD_CLASS } from "@/components/ui/Input";
import { createPortal } from "react-dom";
import { SorrelFlower } from "@/components/SorrelFlower";
import { Button } from "@/components/ui/Button";
import type { FreedUp, GoalCompletion } from "@/lib/goalCompletion";

const CLOSE_BUTTON =
  "inline-flex min-h-11 items-center rounded px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

/**
 * A goal just completed (docs/Goal-Completion.md, D): a centred panel over
 * a dimmed page, shown only in the interaction whose server action
 * completed the goal -- the action returned `completed`, and this renders
 * it. Nothing is stored, so there's nothing to show again on reload or on
 * another device.
 *
 * The flower blooms at the top; under reduced motion it's simply open and
 * the panel and every word of the copy appear unchanged. No confetti, no
 * emoji, no exclamation marks. Focus moves in, Tab stays inside, Escape or
 * a click on the dimmed page closes it, and closing loses nothing -- the
 * goal is already saved and stays on the page, completed.
 */
export function GoalCompletePanel({
  completion,
  onClose,
  onPrimary,
}: {
  completion: GoalCompletion;
  /** Close / Escape / the dimmed page. Focus goes back to the goal. */
  onClose: () => void;
  /** The one primary action: start another goal, or set the next milestone. */
  onPrimary: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();

  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Focus trap: Tab off either end of the panel wraps to the other.
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), select:not([disabled])");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-scrim px-4 py-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-hairline bg-surface px-6 py-8 text-center"
      >
        <SorrelFlower size={176} state="bloom" />
        <div className="flex flex-col gap-2">
          <h2 id={headingId} className="text-2xl font-bold text-ink">
            {completion.headline}
          </h2>
          <p className="text-base text-ink">{completion.figure}</p>
          {completion.nextLine ? <p className="text-sm text-ink-secondary">{completion.nextLine}</p> : null}
        </div>
        {completion.freed ? <FreedSchedules freed={completion.freed} /> : null}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button ref={primaryRef} type="button" onClick={onPrimary}>
            {completion.primaryLabel}
          </Button>
          <button type="button" onClick={onClose} className={CLOSE_BUTTON}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const CHOICE =
  "inline-flex min-h-11 items-center rounded-lg border border-field-border px-3 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50";

// "The part only Sorrel can say": the recurring transfers still feeding
// this goal, named with their amounts, each with Stop / Redirect / Keep.
// Keep writes nothing; it only says the schedule is staying.
function FreedSchedules({ freed }: { freed: FreedUp }) {
  return (
    <div className="flex w-full flex-col gap-3 text-left text-sm">
      <p className="text-ink">{freed.line}</p>
      <ul className="flex flex-col gap-3">
        {freed.schedules.map((s) => (
          <FreedSchedule key={s.id} schedule={s} redirectTo={freed.redirectTo} />
        ))}
      </ul>
    </div>
  );
}

function FreedSchedule({
  schedule,
  redirectTo,
}: {
  schedule: FreedUp["schedules"][number];
  redirectTo: FreedUp["redirectTo"];
}) {
  const [outcome, setOutcome] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [target, setTarget] = useState(redirectTo[0]?.id ?? "");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function stop() {
    setError(undefined);
    start(async () => {
      const result = await callAction(() => stopScheduleAction(schedule.id));
      if (result?.error) setError(result.error);
      else setOutcome("Paused. You can resume it on Recurring any time.");
    });
  }

  function redirect() {
    const name = redirectTo.find((g) => g.id === target)?.name;
    if (!name) return;
    setError(undefined);
    start(async () => {
      const result = await callAction(() => redirectScheduleAction(schedule.id, target));
      if (result?.error) setError(result.error);
      else setOutcome(`It feeds ${name} from its next transfer.`);
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-hairline px-3 py-2">
      <span className="text-ink-secondary">{schedule.label}</span>
      {outcome ? (
        <p role="status" className="text-ink-secondary">
          {outcome}
        </p>
      ) : redirecting ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`redirect-${schedule.id}`}>
            Goal to feed instead
          </label>
          <select
            id={`redirect-${schedule.id}`}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={`${FIELD_CLASS} w-auto`}
          >
            {redirectTo.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={redirect} disabled={pending} className={CHOICE}>
            {pending ? "Saving…" : "Feed this goal"}
          </button>
          <button type="button" onClick={() => setRedirecting(false)} className={CLOSE_BUTTON}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={stop} disabled={pending} className={CHOICE}>
            Stop
          </button>
          {redirectTo.length > 0 ? (
            <button type="button" onClick={() => setRedirecting(true)} disabled={pending} className={CHOICE}>
              Redirect
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setOutcome("Kept. It keeps running as it is.")}
            disabled={pending}
            className={CHOICE}
          >
            Keep
          </button>
        </div>
      )}
      {error ? <p className="text-critical">{error}</p> : null}
    </li>
  );
}
