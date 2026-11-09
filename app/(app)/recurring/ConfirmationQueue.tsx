"use client";

import { useId, useState, useTransition } from "react";
import type { ConfirmationQueueItem } from "@/lib/db/dashboard";
import {
  confirmAllAsExpectedAction,
  confirmAsExpectedAction,
  dismissComingUpAction,
  notYetAction,
  skipOccurrenceAction,
  type ActionState,
} from "@/lib/actions/recurring";
import { confirmationCountLabel, confirmQuestion, toConfirmItems } from "@/lib/confirmationQueue";
import { callAction } from "@/components/useActionForm";
import { Amount } from "@/components/ui/Amount";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { formatDateWithWeekday, formatWeekday } from "@/lib/format";
import { CalendarIcon } from "@/components/ui/icons";
import { ConfirmOccurrenceSheet } from "./ConfirmOccurrenceSheet";
import { PaymentNote } from "@/components/PaymentNote";
import { AmountBasisTag } from "@/components/AmountBasisTag";

// The confirmation queue: the only way a recurring schedule becomes a
// transaction (CLAUDE.md "Confirmation creates every recurring
// transaction"). A queue, never a modal -- nothing is blocked while it has
// items. Housekeeping, not a failure: "4 to confirm", neutral ink and
// neutral chips, no status colour, no "overdue". The same component on the
// dashboard and the recurring page; the items come from
// lib/confirmationQueue.ts and nowhere else.
//
// Four answers per item: landed as expected (one tap), landed differently
// (the sheet), hasn't landed yet (nothing written, asks again tomorrow),
// not happening (drops this occurrence only).

const CHIP =
  "inline-flex min-h-9 items-center rounded-full bg-surface-raised px-3 text-xs font-medium text-ink transition-colors duration-150 hover:bg-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50";
const QUIET =
  "inline-flex min-h-9 items-center rounded px-1 text-xs font-medium text-ink-secondary underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50";

export function ConfirmationQueue({ items }: { items: ConfirmationQueueItem[] }) {
  const headingId = useId();
  const [bulkPending, startBulk] = useTransition();
  const [bulkError, setBulkError] = useState<string | null>(null);

  // One list, two states (lib/confirmationQueue.ts). Only the to-confirm
  // items are counted or confirmed in bulk; coming-up ones are reminders.
  const toConfirm = toConfirmItems(items);
  const comingUp = items.filter((i) => i.state === "coming-up");

  if (items.length === 0) return null;

  const confirmAll = () => {
    setBulkError(null);
    startBulk(async () => {
      const result = await callAction(() =>
        confirmAllAsExpectedAction(toConfirm.map((i) => ({ id: i.recurringId, dueDate: i.dueDate }))),
      );
      if (result.error) setBulkError(result.error);
    });
  };

  return (
    <section
      id="to-confirm"
      aria-labelledby={headingId}
      className="scroll-mt-6 rounded-2xl border border-hairline bg-surface p-4 sm:p-5"
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          {/* A heading in words, never a number in a circle. */}
          <h2 id={headingId} className="text-sm font-medium text-ink">
            {toConfirm.length > 0 ? confirmationCountLabel(toConfirm.length) : "Coming up"}
          </h2>
          <p className="text-xs text-ink-muted">
            {toConfirm.length > 0
              ? "Tell us what happened and it goes in your transactions."
              : "Nothing to do yet. We'll ask about each one on the day."}
          </p>
        </div>
        {toConfirm.length > 1 ? (
          <button type="button" onClick={confirmAll} disabled={bulkPending} className={CHIP}>
            {bulkPending ? "Confirming…" : "Confirm all as expected"}
          </button>
        ) : null}
      </div>

      {/* Confirm all records every card and loan payment in the list too. */}
      {toConfirm.length > 1 ? (
        <PaymentNote payees={toConfirm.flatMap((i) => (i.payee ? [i.payee] : []))} className="mb-2" />
      ) : null}

      {bulkError ? <ErrorMessage message={bulkError} /> : null}

      {toConfirm.length > 0 ? (
        <ul className="divide-y divide-hairline">
          {toConfirm.map((item) => (
            <QueueRow key={item.key} item={item} disabled={bulkPending} />
          ))}
        </ul>
      ) : null}

      {comingUp.length > 0 ? (
        <>
          {toConfirm.length > 0 ? (
            <h3 className="mt-3 border-t border-hairline pt-3 text-xs font-medium text-ink-secondary">Coming up</h3>
          ) : null}
          <ul className="divide-y divide-hairline">
            {comingUp.map((item) => (
              <ComingUpRow key={item.key} item={item} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

// "Rent · $1,850 · Friday". A reminder, not a task: neutral ink, a calendar
// icon, the day's name -- never "in 5 days", "due soon" or "overdue". No
// answers yet; "Got it" hides it until the day, when the same item asks.
function ComingUpRow({ item }: { item: ConfirmationQueueItem }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dismiss = () => {
    setError(null);
    startTransition(async () => {
      const result = await callAction(() => dismissComingUpAction(item.recurringId, item.dueDate));
      if (result?.error) setError(result.error);
    });
  };

  return (
    <li className="flex flex-col gap-1 py-3 text-sm">
      <div className="flex items-center gap-3">
        <CalendarIcon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
        <p className="min-w-0 flex-1 break-words text-ink-secondary">
          <span className="text-ink">{item.name}</span> ·{" "}
          <Amount amount={item.amount} type={item.kind === "Income" ? "Income" : "Expense"} /> ·{" "}
          {item.approximate ? "around " : ""}
          {formatWeekday(item.dueDate)}
        </p>
        <button type="button" onClick={dismiss} disabled={pending} className={QUIET}>
          {pending ? "Hiding…" : "Got it"}
        </button>
      </div>
      {error ? <ErrorMessage message={error} /> : null}
    </li>
  );
}

function QueueRow({ item, disabled }: { item: ConfirmationQueueItem; disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const answer = (call: () => Promise<ActionState>) => {
    setError(null);
    startTransition(async () => {
      const result = await callAction(call);
      if (result?.error) setError(result.error);
    });
  };

  const busy = pending || disabled;

  return (
    <li className="flex flex-col gap-2 py-3 text-sm">
      <div className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1 break-words text-ink sm:truncate">{confirmQuestion(item)}</span>
        <span className="flex shrink-0 items-baseline gap-1.5">
          <Amount amount={item.amount} type={item.kind === "Income" ? "Income" : "Expense"} column />
          <AmountBasisTag basis={item.basis} />
        </span>
      </div>
      <p className="text-xs text-ink-secondary">
        {item.approximate ? "Around " : "Expected "}
        {formatDateWithWeekday(item.dueDate)}
        {item.outstanding > 1
          ? ` · ${item.outstanding - 1} more after this one`
          : ""}
      </p>

      {/* Said before anything is written: this schedule already has a
          transaction in this occurrence's window (lib/confirmationQueue.ts
          alreadyRecorded). Neutral ink -- a fact, not an alarm. "It landed"
          is refused for it on the server too. */}
      {item.alreadyRecorded ? (
        <p className="text-xs text-ink-secondary">
          Already recorded:{" "}
          <Amount amount={item.alreadyRecorded.amount} type={item.kind === "Income" ? "Income" : "Expense"} /> on{" "}
          {formatDateWithWeekday(item.alreadyRecorded.date)}. If that was this one, choose Not happening this time.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => answer(() => confirmAsExpectedAction(item.recurringId, item.dueDate))}
          className={CHIP}
        >
          {pending ? "Saving…" : "It landed"}
        </button>
        <ConfirmOccurrenceSheet
          item={item}
          trigger={(open) => (
            <button type="button" onClick={open} disabled={busy} className={QUIET}>
              It was different
            </button>
          )}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => answer(() => notYetAction(item.recurringId, item.dueDate))}
          className={QUIET}
        >
          Not yet
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => answer(() => skipOccurrenceAction(item.recurringId, item.dueDate))}
          className={QUIET}
        >
          Not happening this time
        </button>
      </div>

      {item.payee ? <PaymentNote payees={[item.payee]} /> : null}

      {error ? <ErrorMessage message={error} /> : null}
    </li>
  );
}
