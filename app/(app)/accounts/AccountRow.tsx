"use client";

import { useState, useTransition } from "react";
import { AccountForm } from "./AccountForm";
import { archiveAccountAction } from "@/lib/actions/accounts";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatCurrency } from "@/lib/format";
import type { Database } from "@/lib/database.types";

type AccountBalanceRow = Database["public"]["Views"]["v_account_balances"]["Row"];

export function AccountRow({ account }: { account: AccountBalanceRow }) {
  const [editing, setEditing] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [archiveError, setArchiveError] = useState<string>();
  const [isArchiving, startArchive] = useTransition();

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
      className={`flex items-center gap-3 px-4 py-3 ${account.is_active ? "" : "opacity-60"}`}
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
        {formatCurrency(account.balance ?? 0)}
      </span>

      {archiveError ? <span className="shrink-0 text-sm text-critical">{archiveError}</span> : null}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="shrink-0 text-sm font-medium text-ink-secondary hover:text-ink"
      >
        Edit
      </button>
      {account.is_active ? (
        <button
          type="button"
          onClick={() => setConfirmingArchive(true)}
          className="shrink-0 text-sm font-medium text-ink-secondary hover:text-ink"
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
    </li>
  );
}
