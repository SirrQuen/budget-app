"use client";

import { useState, useTransition } from "react";
import { deleteTransactionAction, deleteTransferAction } from "@/lib/actions/transactions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TrashIcon } from "@/components/ui/icons";
import { formatCurrency, formatDate, formatSignedAmount } from "@/lib/format";
import type { TransactionType } from "@/lib/db/transactions";

// Shared by the transactions list row and the edit page -- same dialog,
// only where "after delete" lands (redirectToList) and which action fires
// differ. A transfer leg carries transferGroupId, which routes the confirm
// to deleteTransferAction so both legs go together -- never deleteTransactionAction
// on a single leg, or the other leg is orphaned.
export function DeleteTransactionButton({
  id,
  description,
  amount,
  transactionType,
  transactionDate,
  transferGroupId = null,
  redirectToList,
  className = "inline-flex min-h-11 items-center rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-critical focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
  label = "Delete",
}: {
  id: string;
  description: string;
  amount: number;
  transactionType: TransactionType;
  transactionDate: string;
  transferGroupId?: string | null;
  redirectToList: boolean;
  className?: string;
  label?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [isDeleting, startDelete] = useTransition();

  const isTransfer = transferGroupId !== null;
  // A transfer is neither income nor expense -- no sign, same as the list row.
  const amountText = isTransfer ? formatCurrency(amount) : formatSignedAmount(amount, transactionType).text;

  function handleDelete() {
    startDelete(async () => {
      const result =
        transferGroupId !== null
          ? await deleteTransferAction(transferGroupId, redirectToList)
          : await deleteTransactionAction(id, redirectToList);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setConfirming(false);
    });
  }

  return (
    <>
      <button type="button" onClick={() => setConfirming(true)} className={className}>
        {label}
      </button>
      {error ? <span className="ml-2 text-sm text-critical">{error}</span> : null}

      <ConfirmDialog
        open={confirming}
        title={`Delete ${description}, ${amountText}, ${formatDate(transactionDate)}?`}
        description={
          isTransfer
            ? "This can't be undone -- both legs of this transfer will be permanently removed."
            : "This can't be undone -- the transaction will be permanently removed."
        }
        confirmLabel={isDeleting ? "Deleting…" : "Delete"}
        confirmIcon={<TrashIcon className="h-4 w-4" />}
        cancelLabel="Cancel"
        tone="critical"
        onConfirm={handleDelete}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
