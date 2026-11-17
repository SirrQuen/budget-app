"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { callAction } from "@/components/useActionForm";
import { linkGoalToCardAction, unlinkGoalFromCardAction } from "@/lib/actions/goals";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { FormField } from "@/components/ui/FormField";
import { FIELD_CLASS } from "@/components/ui/Input";
import { formatCurrency } from "@/lib/format";
import type { FollowableCard } from "@/lib/db/goals";
import type { GoalCompletion } from "@/lib/goalCompletion";
import { historySentence } from "@/lib/goalFollow";

// A debt payoff goal that follows a credit card or loan (migration 70;
// docs/Log-Again-and-Goal-Links.md, section 2). The card's balance is the
// whole measure: "to go" is what it owes, and the meter runs from what it
// owed when the goal started following it. Nothing here comments on the
// direction a balance moved.

const TEXT_BUTTON =
  "-mx-2 inline-flex min-h-11 shrink-0 items-center self-start rounded px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:mx-0 sm:px-0";

export function FollowCardForm({
  goalId,
  cards,
  historyCount,
  historyTotal,
  onDone,
}: {
  goalId: string;
  /** Liabilities that owe something now (listFollowableCards). */
  cards: FollowableCard[];
  /** Contributions and linked transactions the goal already has. */
  historyCount: number;
  historyTotal: number;
  onDone: () => void;
}) {
  const fieldId = useId();
  const [cardId, setCardId] = useState(cards[0]?.id ?? "");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const card = cards.find((c) => c.id === cardId);

  if (cards.length === 0) {
    return (
      <p className="rounded-xl border border-hairline bg-surface-raised p-3 text-sm text-ink-secondary">
        Add a credit card on the{" "}
        <Link href="/accounts" className="font-medium text-ink underline underline-offset-2">
          Accounts
        </Link>{" "}
        screen to link it.
      </p>
    );
  }

  function follow() {
    setError(undefined);
    start(async () => {
      const result = await callAction(() => linkGoalToCardAction(goalId, cardId));
      if (result?.error) setError(result.error);
      else onDone();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface-raised p-3">
      <FormField
        label="Follow a credit card or loan"
        htmlFor={fieldId}
        hint="The goal measures itself by what the card owes in Sorrel, so payments, new charges and interest all count without you logging them here."
      >
        <select id={fieldId} value={cardId} onChange={(e) => setCardId(e.target.value)} className={FIELD_CLASS}>
          {cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {formatCurrency(c.owed)} owed
            </option>
          ))}
        </select>
      </FormField>
      {card ? (
        <p className="text-sm text-ink-secondary">{historySentence(historyCount, historyTotal, card.name)}</p>
      ) : null}
      <p className="text-xs text-ink-muted">
        Interest shows up in Sorrel when it&apos;s logged, imported with a statement, or the card&apos;s balance is
        updated. Sorrel doesn&apos;t know about it on its own.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={follow} disabled={pending || !card}>
          {pending ? "Linking…" : card ? `Follow ${card.name}` : "Follow"}
        </Button>
        <button type="button" onClick={onDone} className={TEXT_BUTTON}>
          Cancel
        </button>
      </div>
      {error ? <ErrorMessage message={error} /> : null}
    </div>
  );
}

export function StopFollowingButton({
  goalId,
  goalName,
  cardName,
  paidOff,
  carried,
  toGo,
  onCompleted,
}: {
  goalId: string;
  goalName: string;
  cardName: string;
  paidOff: boolean;
  /** What becomes the carried-over contribution. */
  carried: number;
  toGo: number;
  onCompleted: (completion: GoalCompletion) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function stop() {
    setError(undefined);
    start(async () => {
      const result = await callAction(() => unlinkGoalFromCardAction(goalId));
      setConfirming(false);
      if (result?.error) setError(result.error);
      else if (result && "completed" in result && result.completed) onCompleted(result.completed);
    });
  }

  const keeps =
    carried > 0
      ? `The ${formatCurrency(carried)} paid off while following stays as one carried-over contribution`
      : "Nothing was paid off while following, so nothing carries over";
  const rest = paidOff ? ", and it stays paid off." : `, and it keeps ${formatCurrency(toGo)} to go.`;

  return (
    <>
      <button type="button" onClick={() => setConfirming(true)} className={TEXT_BUTTON}>
        Stop following
      </button>
      {error ? <ErrorMessage message={error} /> : null}
      <ConfirmDialog
        open={confirming}
        title={`Stop following ${cardName}?`}
        description={`${goalName} goes back to the payments you log yourself. ${keeps}${rest}`}
        confirmLabel={pending ? "Stopping…" : "Stop following"}
        cancelLabel="Keep following"
        busy={pending}
        onConfirm={stop}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
