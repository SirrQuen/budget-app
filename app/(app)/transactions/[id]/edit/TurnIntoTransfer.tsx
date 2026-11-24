"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { makeTransferAction } from "@/lib/actions/transferConversions";
import { callAction } from "@/components/useActionForm";
import { useShowGoalCompletion } from "@/components/GoalCompletionHost";
import { PreAnchorQuestion, asksAnchorQuestion, useAnchorPreviews } from "@/components/PreAnchorQuestion";
import { parseAnchorAnswer, NO_ANCHOR_ANSWER } from "@/lib/anchorAnswer";
import { findTransferMatches, type TransferCandidate } from "@/lib/importTransfers";
import { directionLabel, turnPlan } from "@/lib/turnIntoTransfer";
import { findImportSameBill, type ImportSameBillItem } from "@/lib/sameBill";
import { formatCurrency, formatDayMonth } from "@/lib/format";
import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { FIELD_CLASS } from "@/components/ui/Input";
import { InfoIcon } from "@/components/ui/icons";

// "Turn into a transfer" (migration 80). An entry that was really money
// moving between the person's own accounts -- a savings transfer or a
// card payment typed as spending, or imported that way before migration
// 76 -- becomes a transfer here. Nothing is decided for them: they pick
// the other account; if an entry there matches (opposite way, exact
// amount, within 5 days) they're asked whether it's the same transfer;
// otherwise the other side is added, asking that account's balance
// question. The write is make_transfer(), atomic; Undo is on the transfer
// it becomes.

const CHOICE =
  "flex min-h-11 flex-1 cursor-pointer items-center gap-2 rounded-lg border border-field-border px-3 py-2 text-sm text-ink transition-colors duration-150 hover:bg-surface has-[:checked]:border-action has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-action";

export function TurnIntoTransfer({
  transaction,
  accounts,
  candidates,
  accountId,
  queue,
}: {
  transaction: {
    id: string;
    type: "Income" | "Expense";
    date: string;
    cents: number;
    description: string;
    categoryName: string;
  };
  /** The person's other active accounts. */
  accounts: { id: string; name: string }[];
  /** Plain entries on those accounts within 5 days, each marked joinable or not. */
  candidates: TransferCandidate[];
  /** The entry's account. */
  accountId: string;
  /** Occurrences waiting in the confirmation queue on that account (a transfer at either end). */
  queue: ImportSameBillItem[];
}) {
  const router = useRouter();
  const showCompletion = useShowGoalCompletion();
  const [open, setOpen] = useState(false);
  const [otherId, setOtherId] = useState("");
  const [pairAnswer, setPairAnswer] = useState<"pair" | "new">();
  const [billAnswer, setBillAnswer] = useState<"same" | "different">();
  const [error, setError] = useState<string>();
  const [saving, startSave] = useTransition();

  const match = useMemo(
    () =>
      otherId === ""
        ? undefined
        : findTransferMatches(
            [{ row: 1, type: transaction.type, date: transaction.date, cents: transaction.cents, otherAccountId: otherId }],
            candidates.filter((c) => c.accountId === otherId),
          ).get(1),
    [otherId, candidates, transaction],
  );
  const plan = turnPlan(otherId, match, pairAnswer);
  const otherName = accounts.find((a) => a.id === otherId)?.name ?? "";
  const label = directionLabel(transaction.type);

  // An added side that is a transfer schedule's waiting occurrence (both
  // ends, this way round) is asked "Is this the same bill?", exactly as an
  // imported transfer is (findImportSameBill), so a scheduled card payment
  // isn't counted twice. A joined entry isn't asked (v1, as import).
  const bill =
    plan.step === "create"
      ? findImportSameBill(
          [{ row: 1, type: transaction.type, date: transaction.date, cents: transaction.cents, transferOtherAccountId: otherId }],
          queue,
          accountId,
        )[0]
      : undefined;
  const ready = plan.step === "join" || (plan.step === "create" && (bill === undefined || billAnswer !== undefined));

  // The added side answers ITS account's balance question (migration 62).
  const anchorPreviews = useAnchorPreviews(plan.step === "create" ? [otherId] : [], transaction.date, null, plan.step === "create");
  const preview = anchorPreviews[otherId];

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ready || (plan.step !== "join" && plan.step !== "create")) return;
    setError(undefined);
    const sameBill = bill && billAnswer ? { answer: billAnswer, recurringId: bill.recurringId, dueDate: bill.dueDate } : null;
    const anchor = plan.step === "create" ? parseAnchorAnswer(new FormData(e.currentTarget), otherId) : NO_ANCHOR_ANSWER;
    startSave(async () => {
      const result = await callAction(() =>
        makeTransferAction({
          transactionId: transaction.id,
          otherAccountId: otherId,
          pairWith: plan.step === "join" ? plan.match.candidate.id : null,
          anchor,
          sameBill,
        }),
      );
      if (result.error !== undefined) {
        setError(result.error);
        return;
      }
      if ("data" in result && result.data) showCompletion(result.data.completion);
      // This page now opens the transfer, with its Undo.
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        Turn into a transfer
      </button>
    );
  }

  return (
    <section aria-labelledby="turn-heading" className="flex w-full flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5">
      <div>
        <h2 id="turn-heading" className="text-base font-semibold text-ink">
          Turn this into a transfer
        </h2>
        <p className="mt-1 max-w-prose text-sm text-ink-secondary">
          For money that moved between your own accounts. A transfer has no category, so this comes out of{" "}
          {transaction.categoryName}. You can undo it.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="turn-other" className="text-sm font-medium text-ink-secondary">
            {label}
          </label>
          <select
            id="turn-other"
            value={otherId}
            onChange={(e) => {
              setOtherId(e.target.value);
              setPairAnswer(undefined);
              setBillAnswer(undefined);
            }}
            className={`${FIELD_CLASS} sm:max-w-xs`}
            required
          >
            <option value="">Choose an account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        {plan.step === "ask" || plan.step === "join" || (plan.step === "create" && pairAnswer === "new") ? (
          (() => {
            const cand = (plan.step === "create" ? match! : plan.match).candidate;
            return (
              <fieldset className="flex flex-col gap-2 rounded-lg bg-surface-raised px-3 py-3 text-sm">
                <legend className="sr-only">Is this the same transfer as the entry on {otherName}?</legend>
                <p className="text-ink-secondary">
                  This matches <Amount amount={cand.cents / 100} type={cand.type} /> already on {otherName} ({cand.description},{" "}
                  {formatDayMonth(cand.date)}). Make them one transfer?
                </p>
                <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-2">
                  <label className={CHOICE}>
                    <input type="radio" name="turn-pair" className="accent-action" checked={pairAnswer === "pair"} onChange={() => setPairAnswer("pair")} />
                    Yes, make them one transfer
                  </label>
                  <label className={CHOICE}>
                    <input type="radio" name="turn-pair" className="accent-action" checked={pairAnswer === "new"} onChange={() => setPairAnswer("new")} />
                    No, add a new entry on {otherName}
                  </label>
                </div>
              </fieldset>
            );
          })()
        ) : null}

        {plan.step === "create" && plan.blocked ? (
          <p className="flex items-start gap-2 text-xs text-ink-secondary">
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <span>
              {otherName} already has {formatCurrency(plan.blocked.candidate.cents / 100)} on {formatDayMonth(plan.blocked.candidate.date)} (
              {plan.blocked.candidate.description}), but it belongs to a schedule, a goal or a bill answer, so it can&apos;t be joined to
              this. This adds a second entry on {otherName}.
            </span>
          </p>
        ) : null}

        {bill ? (
          <fieldset className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface-raised px-3 py-3 text-sm">
            <legend className="sr-only">Is this the same bill?</legend>
            <p className="flex items-start gap-2">
              <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
              <span className="text-ink-secondary">
                <span className="font-medium text-ink">Is this the same bill?</span> As a transfer, this looks like the {formatDayMonth(bill.dueDate)}{" "}
                transfer for {bill.name}, which is still waiting in your confirmation list.
              </span>
            </p>
            <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-2 sm:pl-6">
              <label className={CHOICE}>
                <input type="radio" name="turn-bill" className="accent-action" checked={billAnswer === "same"} onChange={() => setBillAnswer("same")} />
                Yes, they&apos;re the same
              </label>
              <label className={CHOICE}>
                <input type="radio" name="turn-bill" className="accent-action" checked={billAnswer === "different"} onChange={() => setBillAnswer("different")} />
                No, keep both
              </label>
            </div>
          </fieldset>
        ) : null}

        {plan.step === "create" && asksAnchorQuestion(preview) ? (
          <PreAnchorQuestion idPrefix="turn" accountId={otherId} accountName={otherName} preview={preview} nameAccount />
        ) : null}

        {plan.step === "join" ? (
          <p className="text-sm text-ink-secondary">Both entries stay where they are, so neither balance changes.</p>
        ) : plan.step === "create" ? (
          <p className="text-sm text-ink-secondary">
            Adds <Amount amount={transaction.cents / 100} type={transaction.type === "Expense" ? "Income" : "Expense"} /> on {otherName},{" "}
            {formatDayMonth(transaction.date)}.
          </p>
        ) : null}

        {error ? <ErrorMessage severity="critical" message={error} /> : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={saving || !ready}>
            {saving ? "Making it a transfer…" : "Make it a transfer"}
          </Button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setOtherId("");
              setPairAnswer(undefined);
              setError(undefined);
            }}
            className="inline-flex min-h-11 items-center rounded px-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            Never mind
          </button>
        </div>
      </form>
    </section>
  );
}
