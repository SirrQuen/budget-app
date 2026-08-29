"use client";

import { useState, useTransition } from "react";
import { AccountForm } from "./AccountForm";
import { archiveAccountAction } from "@/lib/actions/accounts";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FullFormOverlay } from "@/components/quick-add/FullFormOverlay";
import { formatAccountBalance } from "@/lib/format";
import { isLiabilityAccountType } from "@/lib/accountOptions";
import type { Database } from "@/lib/database.types";
import type { CategoryWithGroup } from "@/lib/db/categories";
import type { AddTransactionPrefill, TransactionAccountOption } from "../transactions/AddTransactionForm";

type AccountBalanceRow = Database["public"]["Views"]["v_account_balances"]["Row"];

export function AccountRow({
  account,
  transactionAccounts,
  defaultFromAccountId,
  incomeCategories,
  expenseCategories,
}: {
  account: AccountBalanceRow;
  /** For the "Make a payment" transfer form -- every active account, not just this row's. */
  transactionAccounts: TransactionAccountOption[];
  /** Pre-fills "From" on a payment transfer -- the user's most-used asset account. */
  defaultFromAccountId: string | null;
  incomeCategories: CategoryWithGroup[];
  expenseCategories: CategoryWithGroup[];
}) {
  const [editing, setEditing] = useState(false);
  const [makingPayment, setMakingPayment] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [archiveError, setArchiveError] = useState<string>();
  const [isArchiving, startArchive] = useTransition();

  // A payment only makes sense on an active card/loan that actually owes
  // something -- balance 0 means it's already paid off.
  const canMakePayment =
    account.is_active === true &&
    isLiabilityAccountType(account.account_type ?? "") &&
    (account.balance ?? 0) < 0;

  const paymentPrefill: AddTransactionPrefill = {
    transaction_type: "Transfer",
    toAccountId: account.account_id ?? "",
    fromAccountId: defaultFromAccountId ?? "",
    // Card/loan balances are stored negative -- the transfer form (like
    // every other amount field) collects a positive number.
    amount: String(Math.abs(account.balance ?? 0)),
    description: `Payment to ${account.account_name ?? "this account"}`,
  };

  function handleArchive() {
    startArchive(async () => {
      const result = await archiveAccountAction(account.account_id ?? "");
      if (result?.error) {
        setArchiveError(result.error);
        return;
      }
      setConfirmingArchive(false);
    });
  }

  if (editing) {
    return (
      <li className="p-4">
        <AccountForm
          account={account}
          onSuccess={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li
      className={`flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-surface-raised ${account.is_active ? "" : "opacity-60"}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{account.account_name}</span>
          <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-xs font-medium text-ink-secondary">
            {account.account_type}
          </span>
          {!account.is_active ? (
            <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-xs font-medium text-ink-muted">
              Archived
            </span>
          ) : null}
        </div>
        {account.institution ? (
          <p className="mt-0.5 truncate text-sm text-ink-muted">{account.institution}</p>
        ) : null}
      </div>

      <span className="shrink-0 text-sm font-medium tabular-nums text-ink">
        {formatAccountBalance(account.balance ?? 0, account.account_type ?? "")}
      </span>

      {archiveError ? <span className="shrink-0 text-sm text-critical">{archiveError}</span> : null}
      {canMakePayment ? (
        <button
          type="button"
          onClick={() => setMakingPayment(true)}
          className="shrink-0 rounded text-sm font-medium text-action transition-colors duration-150 hover:text-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Make a payment
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="shrink-0 rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        Edit
      </button>
      {account.is_active ? (
        <button
          type="button"
          onClick={() => setConfirmingArchive(true)}
          className="shrink-0 rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Archive
        </button>
      ) : null}

      <ConfirmDialog
        open={confirmingArchive}
        title={`Archive "${account.account_name}"?`}
        description="It'll drop out of the picker for new transactions, but past transactions keep it -- your history survives. You're archiving, not deleting."
        confirmLabel={isArchiving ? "Archiving…" : "Archive"}
        cancelLabel="Cancel"
        onConfirm={handleArchive}
        onCancel={() => setConfirmingArchive(false)}
      />

      {makingPayment ? (
        <FullFormOverlay
          accounts={transactionAccounts}
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
          prefill={paymentPrefill}
          onClose={() => setMakingPayment(false)}
          onSaved={() => setMakingPayment(false)}
        />
      ) : null}
    </li>
  );
}
