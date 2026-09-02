"use client";

import { useActionState, useState } from "react";
import { deleteAccountAction, type DeleteAccountState } from "@/lib/actions/account";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { WarningIcon, TrashIcon } from "@/components/ui/icons";
import type { AccountDeletionSummary } from "@/lib/db/profile";

const CONFIRM_PHRASE = "DELETE";

function plural(n: number, word: string) {
  return n === 1 ? word : `${word}s`;
}

// "a", "a and b", "a, b and c" -- no Oxford comma, matching the spec's
// "2 goals and all budgets".
function joinList(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function summarySentence(s: AccountDeletionSummary) {
  const items: string[] = [];
  if (s.accounts) items.push(`${s.accounts.toLocaleString("en-US")} ${plural(s.accounts, "account")}`);
  if (s.transactions)
    items.push(`${s.transactions.toLocaleString("en-US")} ${plural(s.transactions, "transaction")}`);
  if (s.goals) items.push(`${s.goals.toLocaleString("en-US")} ${plural(s.goals, "goal")}`);
  if (s.budgets) items.push("all budgets");

  if (items.length === 0) {
    return "This will permanently delete your account and everything in it.";
  }
  return `This will permanently delete your ${joinList(items)}.`;
}

export function DeleteAccountSection({ summary }: { summary: AccountDeletionSummary }) {
  const [state, action, pending] = useActionState<DeleteAccountState, FormData>(
    deleteAccountAction,
    undefined,
  );
  const [confirmation, setConfirmation] = useState("");

  // A checkbox is one careless click; typing the word is a deliberate act.
  const armed = confirmation.trim() === CONFIRM_PHRASE;

  return (
    <section
      aria-labelledby="delete-account-heading"
      className="rounded-2xl border border-critical/40 bg-critical/5 p-5"
    >
      <h2
        id="delete-account-heading"
        className="flex items-center gap-2 text-base font-semibold text-ink"
      >
        <WarningIcon className="h-5 w-5 shrink-0 text-critical" aria-hidden="true" />
        Delete account
      </h2>

      <p className="mt-2 max-w-prose text-sm text-ink-secondary">{summarySentence(summary)}</p>
      <p className="mt-2 max-w-prose text-sm text-ink-secondary">
        This cannot be undone, and no backup is kept. Once it is gone, it is gone.
      </p>

      <form action={action} className="mt-4 flex flex-col gap-3 sm:max-w-xs">
        <label htmlFor="confirmation" className="text-sm text-ink-secondary">
          Type <span className="font-semibold text-ink">{CONFIRM_PHRASE}</span> to confirm
        </label>
        <Input
          id="confirmation"
          name="confirmation"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label={`Type ${CONFIRM_PHRASE} to confirm account deletion`}
          aria-describedby={state?.error ? "delete-account-error" : undefined}
        />

        {state?.error ? (
          <p
            id="delete-account-error"
            role="alert"
            className="flex items-start gap-2 text-sm text-critical"
          >
            <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{state.error}</span>
          </p>
        ) : null}

        <Button
          type="submit"
          variant="critical"
          disabled={!armed || pending}
          className="gap-1.5 self-start"
        >
          <TrashIcon className="h-4 w-4" aria-hidden="true" />
          {pending ? "Deleting…" : "Delete my account"}
        </Button>
      </form>
    </section>
  );
}
