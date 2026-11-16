"use client";

import { useState, useTransition } from "react";
import { callAction } from "@/components/useActionForm";
import { replaceContributionWithLinkAction } from "@/lib/actions/transactions";
import type { SameMoneyPair } from "@/lib/goalLinks";
import { formatCurrency, formatDayMonth } from "@/lib/format";
import { InfoIcon } from "@/components/ui/icons";

// "Is this the same money?" (docs/Log-Again-and-Goal-Links.md, section 3;
// same_goal_money, migration 69). A transaction just linked to a goal that
// already has a hand-entered contribution of the same amount within 3
// days: both would count. Never merged silently. "Yes" replaces the hand
// entry with the link; "No" keeps both and writes nothing.
//
// Neutral ink and an info icon: a question about the record, not a warning
// about money (the same shape as SameBillQuestion).

const ANSWER =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-field-border px-3 py-2 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50";

const LINK =
  "min-h-11 rounded px-1 text-sm font-medium text-ink-secondary underline underline-offset-2 transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50";

export function sameMoneyQuestionText(pair: SameMoneyPair): string {
  return `Is this the same money as your ${formatCurrency(pair.amount)} contribution to ${pair.goalName} on ${formatDayMonth(pair.contributionDate)}?`;
}

export function SameMoneyQuestion({
  pair,
  onDone,
  className = "",
}: {
  pair: SameMoneyPair;
  /** Closes it once answered (or, after an edit, moves on). */
  onDone: () => void;
  className?: string;
}) {
  const [error, setError] = useState<string>();
  const [answered, setAnswered] = useState<"same" | "different" | null>(null);
  const [pending, start] = useTransition();

  function answerSame() {
    setError(undefined);
    start(async () => {
      const result = await callAction(() => replaceContributionWithLinkAction(pair.transactionId, pair.contributionId));
      if (result?.error) {
        setError(result.error);
        return;
      }
      setAnswered("same");
    });
  }

  if (answered !== null) {
    return (
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-secondary ${className}`}>
        <p role="status">
          {answered === "same"
            ? `Counted once now, as this transaction. The ${formatCurrency(pair.amount)} you entered by hand is gone from ${pair.goalName}.`
            : `Keeping both. ${pair.goalName} counts each of them.`}
        </p>
        <button type="button" onClick={onDone} className={LINK}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={`same-money-${pair.transactionId}`}
      className={`flex flex-col gap-2 rounded-lg border border-hairline bg-surface-raised px-3 py-3 text-sm ${className}`}
    >
      <div className="flex items-start gap-2">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
        <p id={`same-money-${pair.transactionId}`} className="flex-1 font-medium text-ink">
          {sameMoneyQuestionText(pair)}
        </p>
      </div>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-2 sm:pl-6">
        <button type="button" className={ANSWER} disabled={pending} onClick={answerSame}>
          Yes, it&apos;s the same
        </button>
        <button type="button" className={ANSWER} disabled={pending} onClick={() => setAnswered("different")}>
          No, keep both
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-critical sm:pl-6">
          {error}
        </p>
      ) : null}
    </div>
  );
}
