"use client";

import { useEffect, useRef, useState } from "react";
import { callAction } from "@/components/useActionForm";
import { balanceAnchorAction } from "@/lib/actions/transactions";
import {
  anchorChoiceField,
  anchorSetAtField,
  storedAnswerApplies,
  storedChoice,
  type AnchorAnswerColumns,
  type AnchorPreview,
} from "@/lib/anchorAnswer";
import { formatAccountBalance, formatDayMonth } from "@/lib/format";
import { InfoIcon } from "@/components/ui/icons";

// The pre-anchor question (migration 62). It replaces the old "this is
// before your balance date" note, which stated a fact and left the person
// to work out the consequence: a charge that was still pending when they
// read their balance, logged on its earlier posted date, never counted.
//
// Shown only when SQL's anchor rule says the date alone keeps this
// transaction out of the balance (balance_anchor_preview ->
// anchor_includes()); this component never decides that. The answer is
// REQUIRED: either default is wrong ("yes" reproduces the bug, "no"
// double-counts back-filled history), so neither radio starts checked on a
// new transaction, and the database refuses a save without one.
//
// Used by the transaction form (create and edit), the transfer editor and
// the recurring confirm sheet, so all of them ask it the same way.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Asks SQL about each account the form names, once per account and date.
 * undefined = not answered yet; null = couldn't be answered (no question
 * is shown, and the database still has the last word on save).
 */
export function useAnchorPreviews(
  accountIds: string[],
  date: string,
  transactionId: string | null,
  enabled = true,
): Record<string, AnchorPreview | null | undefined> {
  const [previews, setPreviews] = useState<Record<string, AnchorPreview | null>>({});
  const asked = useRef(new Set<string>());

  const unasked = enabled && DATE_RE.test(date)
    ? accountIds
        .filter((id) => id !== "")
        .map((id) => `${id}|${date}`)
        .filter((key) => !(key in previews))
        .join(",")
    : "";

  useEffect(() => {
    if (unasked === "") return;
    for (const key of unasked.split(",")) {
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      const [accountId, d] = key.split("|");
      void callAction(() => balanceAnchorAction(accountId, d, transactionId)).then((answer) => {
        setPreviews((prev) => ({
          ...prev,
          [key]: answer && typeof answer === "object" && "countsByDate" in answer ? answer : null,
        }));
      });
    }
  }, [unasked, transactionId]);

  const byAccount: Record<string, AnchorPreview | null | undefined> = {};
  for (const id of accountIds) byAccount[id] = previews[`${id}|${date}`];
  return byAccount;
}

/** True when the question applies to this preview. */
export function asksAnchorQuestion(preview: AnchorPreview | null | undefined): preview is AnchorPreview {
  return preview !== null && preview !== undefined && !preview.countsByDate;
}

export function PreAnchorQuestion({
  idPrefix,
  accountId,
  accountName,
  preview,
  stored,
  nameAccount = false,
}: {
  /** Unique per form instance, for the radio ids. */
  idPrefix: string;
  accountId: string;
  accountName: string;
  preview: AnchorPreview;
  /** The answer already stored on the transaction being edited, if any. */
  stored?: AnchorAnswerColumns;
  /** Say which account -- a transfer asks about each leg. */
  nameAccount?: boolean;
}) {
  // A stored answer applies only to the anchor it answered. After a new
  // balance it's void, so the question asks again from blank -- and says why.
  const applies = stored ? storedAnswerApplies(stored, preview.anchorSetAt) : false;
  const initial = stored && applies ? storedChoice(stored) : null;
  const staleChoice = stored && !applies ? storedChoice(stored) : null;

  const balance = formatAccountBalance(preview.anchorBalance, preview.accountType);
  const on = formatDayMonth(preview.anchorDate);
  const legendId = `${idPrefix}-anchor-${accountId}`;
  const yesId = `${legendId}-yes`;
  const noId = `${legendId}-no`;

  return (
    <fieldset
      aria-labelledby={legendId}
      className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface-raised px-3 py-3 text-sm"
    >
      <input type="hidden" name={anchorSetAtField(accountId)} value={preview.anchorSetAt} />
      <div id={legendId} className="flex items-start gap-2">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
        <p className="flex-1 text-ink-secondary">
          <span className="text-ink">
            This is dated before your {nameAccount ? `${accountName} ` : ""}balance of {balance} on {on}.
          </span>{" "}
          Was it already included in that balance?
        </p>
      </div>
      {initial ? (
        <p className="text-xs text-ink-muted">
          {initial === "add"
            ? "You said that balance didn't include it, so it counts toward the balance despite its date."
            : "You said that balance already included it, so it doesn't change the balance."}
        </p>
      ) : null}
      {staleChoice ? (
        <p className="text-xs text-ink-muted">
          You answered this for an earlier balance
          {staleChoice === "add" ? " (you added it then)" : " (it was already counted then)"}. You&apos;ve set a
          new balance since, so it needs an answer for this one.
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-2">
        <label
          htmlFor={yesId}
          className="flex min-h-11 flex-1 cursor-pointer items-center gap-2 rounded-lg border border-field-border px-3 py-2 text-ink transition-colors duration-150 hover:bg-surface has-[:checked]:border-action has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-action"
        >
          <input
            id={yesId}
            type="radio"
            name={anchorChoiceField(accountId)}
            value="counted"
            required
            defaultChecked={initial === "counted"}
            className="accent-action"
          />
          Yes, it&apos;s already counted
        </label>
        <label
          htmlFor={noId}
          className="flex min-h-11 flex-1 cursor-pointer items-center gap-2 rounded-lg border border-field-border px-3 py-2 text-ink transition-colors duration-150 hover:bg-surface has-[:checked]:border-action has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-action"
        >
          <input
            id={noId}
            type="radio"
            name={anchorChoiceField(accountId)}
            value="add"
            required
            defaultChecked={initial === "add"}
            className="accent-action"
          />
          No, add it to my balance
        </label>
      </div>
    </fieldset>
  );
}

/**
 * On an edit that leaves the date, amount and account alone, the question
 * isn't asked again (the database doesn't ask either). This says what's
 * stored instead, so the exception stays visible: counted despite its
 * date, already in the balance, or -- for a row from before the question
 * existed, or one answered for an earlier balance -- simply not counted.
 */
export function StoredAnchorAnswer({
  accountName,
  preview,
  stored,
  nameAccount = false,
}: {
  accountName: string;
  preview: AnchorPreview;
  stored?: AnchorAnswerColumns;
  nameAccount?: boolean;
}) {
  const balance = formatAccountBalance(preview.anchorBalance, preview.accountType);
  const on = formatDayMonth(preview.anchorDate);
  const choice = stored && storedAnswerApplies(stored, preview.anchorSetAt) ? storedChoice(stored) : null;
  const which = nameAccount ? `${accountName} ` : "";

  return (
    <p className="flex items-start gap-2 rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink-secondary">
      <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
      <span className="flex-1">
        {choice === "add"
          ? `Dated before your ${which}balance of ${balance} on ${on}. You said that balance didn't include it, so it counts toward the balance despite its date.`
          : choice === "counted"
            ? `Dated before your ${which}balance of ${balance} on ${on}. You said that balance already included it, so it doesn't change the balance.`
            : `Dated before your ${which}balance of ${balance} on ${on}, so it isn't counted in that balance.`}
      </span>
    </p>
  );
}
