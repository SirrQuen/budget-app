"use client";

import { useState, useTransition } from "react";
import { deleteTransactionAction } from "@/lib/actions/transactions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TrashIcon } from "@/components/ui/icons";
import { formatDate, formatSignedAmount } from "@/lib/format";
import type { TransactionType } from "@/lib/db/transactions";

// Shared by the transactions list row and the edit page -- same dialog,
// same action, only where "after delete" lands differs (see
// deleteTransactionAction for why that's an explicit flag, not inferred).
export function DeleteTransactionButton({
  id,
  description,
  amount,
  transactionType,
  transactionDate,
  redirectToList,
  className = "text-sm font-medium text-ink-secondary hover:text-critical",
  label = "Delete",
}: {
  id: string;
  description: string;
  amount: number;
  transactionType: TransactionType;
  transactionDate: string;
  redirectToList: boolean;
  className?: string;
  label?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [isDeleting, startDelete] = useTransition();

  const signed = formatSignedAmount(amount, transactionType);

  function handleDelete() {
    startDelete(async () => {
      const result = await deleteTransactionAction(id, redirectToList);
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
        title={`Delete ${description}, ${signed.text}, ${formatDate(transactionDate)}?`}
        description="This can't be undone -- the transaction will be permanently removed."
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
