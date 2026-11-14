"use client";

import { useState, useTransition } from "react";
import { callAction } from "@/components/useActionForm";
import {
  clearDifferentBillAction,
  confirmSameBillAction,
  recordDifferentBillAction,
} from "@/lib/actions/sameBill";
import { differentBillLine, sameBillQuestionParts, type SameBillPair } from "@/lib/sameBill";
import { Amount } from "@/components/ui/Amount";
import { InfoIcon } from "@/components/ui/icons";

// "Is this the same bill?" (docs/Views-Search-Import-Layout.md, item 4;
// migration 66). One question for a schedule's next occurrence and an
// entry the person added for the same bill -- shown where both would
// otherwise appear (the dashboard's Upcoming list), right after saving
// such an entry, and on the entry's own screen. Never a merge without an
// answer, and never a modal: nothing waits on it.
//
// Neutral ink, an info icon, no status colour: a question about the
// record, not a warning about money.

const ANSWER =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-field-border px-3 py-2 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50";

const LATER =
  "min-h-11 rounded px-1 text-sm font-medium text-ink-secondary underline underline-offset-2 transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50";

const amountType = (pair: SameBillPair) => (pair.kind === "Income" ? "Income" : "Expense");

export function SameBillQuestion({
  pair,
  className = "",
  onDismiss,
}: {
  pair: SameBillPair;
  className?: string;
  /**
   * After a save: "Ask me later" closes it, writing nothing -- the pair is
   * still asked in Upcoming and on the entry. Also closes it once answered.
   */
  onDismiss?: () => void;
}) {
  const [error, setError] = useState<string>();
  const [answered, setAnswered] = useState<"same" | "different" | null>(null);
  const [pending, start] = useTransition();
  const { before, after } = sameBillQuestionParts(pair);

  function answer(same: boolean) {
    setError(undefined);
    start(async () => {
      const result = await callAction(() =>
        same
          ? confirmSameBillAction(pair.recurringId, pair.transactionId, pair.dueDate)
          : recordDifferentBillAction(pair.recurringId, pair.transactionId, pair.dueDate),
      );
      if (result?.error) {
        setError(result.error);
        return;
      }
      setAnswered(same ? "same" : "different");
    });
  }

  if (answered !== null) {
    return (
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-secondary ${className}`}>
        <p role="status">
          {answered === "same"
            ? `Counted once now, as the entry you added. ${pair.name}'s schedule carries on from the next one.`
            : "Keeping both. We won't ask about these two again."}
        </p>
        {onDismiss ? (
          <button type="button" onClick={onDismiss} className={LATER}>
            Close
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={`same-bill-${pair.transactionId}`}
      className={`flex flex-col gap-2 rounded-lg border border-hairline bg-surface-raised px-3 py-3 text-sm ${className}`}
    >
      <div className="flex items-start gap-2">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
        <div className="flex-1">
          <p id={`same-bill-${pair.transactionId}`} className="font-medium text-ink">
            Is this the same bill?
          </p>
          <p className="text-ink-secondary">
            {before}
            <Amount amount={pair.amount} type={amountType(pair)} />
            {after}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-2 sm:pl-6">
        <button type="button" className={ANSWER} disabled={pending} onClick={() => answer(true)}>
          Yes, they&apos;re the same
        </button>
        <button type="button" className={ANSWER} disabled={pending} onClick={() => answer(false)}>
          No, keep both
        </button>
        {onDismiss ? (
          <button type="button" onClick={onDismiss} disabled={pending} className={`${LATER} sm:self-center`}>
            Ask me later
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-critical sm:pl-6">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A "No, keep both" read back on the entry's screen -- always with a way
 * to change it. A wrong "No" would otherwise make the double count
 * permanent. Changing it clears the answer; the page then asks again.
 */
export function DifferentBillNote({
  recurringId,
  transactionId,
  scheduleName,
  occurrenceDueDate,
}: {
  recurringId: string;
  transactionId: string;
  scheduleName: string;
  occurrenceDueDate: string;
}) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function change() {
    setError(undefined);
    start(async () => {
      const result = await callAction(() => clearDifferentBillAction(recurringId, transactionId));
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-secondary">
      <InfoIcon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
      <span>{differentBillLine(scheduleName, occurrenceDueDate)}</span>
      <button
        type="button"
        disabled={pending}
        onClick={change}
        className="rounded text-sm font-medium text-ink underline underline-offset-2 transition-colors duration-150 hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50"
      >
        Change your answer
      </button>
      {error ? (
        <span role="alert" className="text-critical">
          {error}
        </span>
      ) : null}
    </div>
  );
}
