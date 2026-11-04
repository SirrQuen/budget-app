"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { callAction, useActionForm } from "@/components/useActionForm";
import { countsTowardBalanceAction, updateTransferAction, type ActionState } from "@/lib/actions/transactions";
import type { TransferForEdit } from "@/lib/db/transactions";
import type { TransactionAccountOption } from "../../AddTransactionForm";
import { FormField, useFieldId } from "@/components/ui/FormField";
import { Input, FIELD_CLASS } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { BalanceDateNote } from "@/components/BalanceDateNote";
import { PaymentNote } from "@/components/PaymentNote";
import { EditScopeChoice } from "@/components/EditScopeChoice";
import { paymentPayee } from "@/lib/accountOptions";
import { amountChanged } from "@/lib/recurringEditScope";
import { transferEffect, transferEffectLine } from "@/lib/transferEdit";

// A transfer is ONE THING WITH TWO LEGS (docs/Recurring-Amounts-and-
// Transfer-Editing.md, 4). Opening either leg opens this, never a
// transaction editor. From, to, amount, date, description and notes are
// all editable, and the direction can be swapped. Saving goes through
// update_transfer() (migration 59): both legs in one call, or neither.
//
// Each leg sits on its own account with its own balance date, so moving
// the date can put one leg before its account's balance date and leave the
// other after its own. The note is asked per account from SQL
// (counts_toward_balance_preview), keyed by that leg's own row.
export function TransferEditForm({
  transfer,
  accounts,
}: {
  transfer: TransferForEdit;
  accounts: TransactionAccountOption[];
}) {
  const fieldId = useFieldId();
  const [state, formAction, pending, submit] = useActionForm<ActionState>(updateTransferAction, undefined);
  const [fromAccountId, setFromAccountId] = useState(transfer.fromLeg.accountId);
  const [toAccountId, setToAccountId] = useState(transfer.toLeg.accountId);
  const [amount, setAmount] = useState(String(transfer.amount));
  const [date, setDate] = useState(transfer.date);
  const [answers, setAnswers] = useState<Record<string, boolean | null>>({});
  const asked = useRef(new Set<string>());

  const from = accounts.find((a) => a.id === fromAccountId);
  const to = accounts.find((a) => a.id === toAccountId);
  const sameAccount = fromAccountId === toAccountId;

  // The Expense leg is always the source, the Income leg the destination --
  // so the source account is asked with the Expense leg's row and the
  // destination with the Income leg's, whichever accounts they now name.
  const legs = [
    { account: from, legId: transfer.fromLeg.id },
    { account: to, legId: transfer.toLeg.id },
  ];
  const keyFor = (accountId: string, legId: string) => `${accountId}|${date}|${legId}`;
  const unasked = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? legs
        .flatMap((l) => (l.account ? [keyFor(l.account.id, l.legId)] : []))
        .filter((k) => !(k in answers))
        .join(",")
    : "";
  useEffect(() => {
    if (unasked === "") return;
    for (const key of unasked.split(",")) {
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      const [accountId, d, legId] = key.split("|");
      void callAction(() => countsTowardBalanceAction(accountId, d, legId)).then((answer) => {
        setAnswers((prev) => ({ ...prev, [key]: typeof answer === "boolean" ? answer : null }));
      });
    }
  }, [unasked]);

  const originalFrom = accounts.find((a) => a.id === transfer.fromLeg.accountId);
  const originalTo = accounts.find((a) => a.id === transfer.toLeg.accountId);
  const effectLine =
    from && to && originalFrom && originalTo && !sameAccount
      ? transferEffectLine(
          transferEffect(originalFrom.account_type, originalTo.account_type),
          transferEffect(from.account_type, to.account_type),
          from.account_name,
          to.account_name,
        )
      : null;

  const accountLabel = (a: TransactionAccountOption) => (a.is_active ? a.account_name : `${a.account_name} (archived)`);

  return (
    <form action={formAction} onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-hairline bg-surface p-5">
      <input type="hidden" name="transfer_group_id" value={transfer.transferGroupId} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <FormField label="From" htmlFor={fieldId("from")} required>
          <select
            id={fieldId("from")}
            name="fromAccountId"
            required
            value={fromAccountId}
            onChange={(e) => setFromAccountId(e.target.value)}
            className={FIELD_CLASS}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {accountLabel(a)}
              </option>
            ))}
          </select>
        </FormField>

        <button
          type="button"
          onClick={() => {
            setFromAccountId(toAccountId);
            setToAccountId(fromAccountId);
          }}
          className="self-start rounded-full px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action sm:self-end"
        >
          Swap direction
        </button>

        <FormField label="To" htmlFor={fieldId("to")} required>
          <select
            id={fieldId("to")}
            name="toAccountId"
            required
            value={toAccountId}
            onChange={(e) => setToAccountId(e.target.value)}
            className={FIELD_CLASS}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {accountLabel(a)}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      {sameAccount ? <ErrorMessage message="Choose two different accounts for a transfer." /> : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <FormField label="Date" htmlFor={fieldId("date")} required>
          <Input
            id={fieldId("date")}
            name="transaction_date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </FormField>
        <FormField label="Amount" htmlFor={fieldId("amount")} required>
          <Input
            id={fieldId("amount")}
            name="amount"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </FormField>
      </div>

      {transfer.schedule && Number(amount) > 0 && amountChanged(transfer.amount, Number(amount)) ? (
        <EditScopeChoice
          scheduleName={transfer.schedule.description}
          amountIsVariable={transfer.schedule.amountIsVariable}
        />
      ) : null}

      <FormField label="Description" htmlFor={fieldId("description")} required>
        <Input
          id={fieldId("description")}
          name="description"
          required
          maxLength={120}
          defaultValue={transfer.description}
        />
      </FormField>

      <FormField label="Notes" htmlFor={fieldId("notes")}>
        <textarea
          id={fieldId("notes")}
          name="notes"
          rows={2}
          defaultValue={transfer.notes ?? ""}
          className={FIELD_CLASS}
        />
      </FormField>

      {legs.map((l) =>
        l.account && answers[keyFor(l.account.id, l.legId)] === false ? (
          <BalanceDateNote
            key={l.legId}
            accountId={l.account.id}
            accountName={l.account.account_name}
            openingDate={l.account.opening_date}
          />
        ) : null,
      )}

      {effectLine ? <p className="text-sm text-ink-secondary">{effectLine}</p> : null}

      <PaymentNote payees={[paymentPayee(to?.account_type)].flatMap((p) => (p ? [p] : []))} />

      {state?.error ? <ErrorMessage message={state.error} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || sameAccount}>
          {pending ? "Saving…" : "Save transfer"}
        </Button>
        <Link
          href="/transactions"
          className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
