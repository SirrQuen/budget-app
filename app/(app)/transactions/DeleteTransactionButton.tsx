"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTransactionAction, deleteTransferAction } from "@/lib/actions/transactions";
import { separateTransferAction } from "@/lib/actions/transferConversions";
import {
  bothEntriesSentence,
  importedCategoryLabel,
  keptEntryId,
  separateSentence,
  type TransferOrigin,
} from "@/lib/turnIntoTransfer";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FIELD_CLASS } from "@/components/ui/Input";
import { TrashIcon } from "@/components/ui/icons";
import { formatCurrency, formatDate, formatSignedAmount } from "@/lib/format";
import type { TransactionType } from "@/lib/db/transactions";
import { callAction } from "@/components/useActionForm";
import { goalDeleteNote } from "@/lib/goalLinks";

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
  transferAccounts,
  forecastNote,
  goalName,
  origin,
  categoryOptions,
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
  /** Transfer only: names both accounts in the confirmation, e.g. "from
   *  Checking to Savings". Omitted when a leg's account can't be resolved. */
  transferAccounts?: { from: string; to: string };
  /**
   * What deleting does to a "same bill" answer (sameBillDeleteNote,
   * migration 66): the occurrence goes back on the schedule, or -- when it
   * can't -- that the bill leaves the forecast. Said before anything goes.
   */
  forecastNote?: string;
  /** The goal this row counts toward (migration 69): deleting takes it off. */
  goalName?: string | null;
  /**
   * A transfer that was made from an entry ("Turn into a transfer") or
   * that an import joined to one: the dialog names both entries and
   * offers "Separate them instead" (rulings of 2026-11-24).
   */
  origin?: TransferOrigin;
  /**
   * Active categories, for an import-joined transfer: its imported side
   * stays when separated and needs one of its own type (ruled 2026-11-24).
   */
  categoryOptions?: { id: string; name: string; type: TransactionType }[];
  redirectToList: boolean;
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [importedCategory, setImportedCategory] = useState("");
  const [error, setError] = useState<string>();
  const [isDeleting, startDelete] = useTransition();
  const [isSeparating, startSeparate] = useTransition();

  const isTransfer = transferGroupId !== null;
  // A transfer is neither income nor expense -- no sign, same as the list row.
  const amountText = isTransfer ? formatCurrency(amount) : formatSignedAmount(amount, transactionType).text;

  const title =
    isTransfer && transferAccounts
      ? `Delete transfer of ${amountText} from ${transferAccounts.from} to ${transferAccounts.to}?`
      : `Delete ${description}, ${amountText}, ${formatDate(transactionDate)}?`;

  function handleDelete() {
    startDelete(async () => {
      const result =
        transferGroupId !== null
          ? await callAction(() => deleteTransferAction(transferGroupId, redirectToList))
          : await callAction(() => deleteTransactionAction(id, redirectToList));
      if (result?.error) {
        setError(result.error);
        return;
      }
      setConfirming(false);
    });
  }

  // The entries the person had come back. A side "Turn into a transfer"
  // added goes; an imported side stays, in the category chosen here. On
  // the edit page the open row may be the one that goes, so it moves to
  // the entry that stays; in a list the refresh is enough.
  const needsCategory = origin?.kind === "import";
  const importedOptions =
    origin?.kind === "import"
      ? (categoryOptions ?? []).filter((c) => c.type === origin.imported.type).sort((a, b) => a.name.localeCompare(b.name))
      : [];

  function handleSeparate() {
    if (!origin) return;
    if (needsCategory && importedCategory === "") return;
    startSeparate(async () => {
      const result = await callAction(() =>
        separateTransferAction(origin.transferGroupId, origin.kind, needsCategory ? importedCategory : null),
      );
      if (result?.error) {
        setError(result.error);
        setConfirming(false);
        return;
      }
      setConfirming(false);
      if (redirectToList) router.replace(`/transactions/${keptEntryId(origin)}/edit`);
      else router.refresh();
    });
  }

  const dialogText = [
    origin
      ? `${bothEntriesSentence(origin)} This can't be undone. ${separateSentence(origin)}`
      : isTransfer
        ? "This can't be undone -- both legs of this transfer will be permanently removed."
        : "This can't be undone -- the transaction will be permanently removed.",
    forecastNote ?? "",
    goalName ? goalDeleteNote(goalName) : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <button type="button" onClick={() => setConfirming(true)} className={className}>
        {label}
      </button>
      {error ? <span className="ml-2 text-sm text-critical">{error}</span> : null}

      <ConfirmDialog
        open={confirming}
        title={title}
        description={dialogText}
        confirmLabel={isDeleting ? "Deleting…" : origin ? "Delete both" : "Delete"}
        confirmIcon={<TrashIcon className="h-4 w-4" />}
        cancelLabel="Cancel"
        tone="critical"
        busy={isDeleting || isSeparating}
        secondaryLabel={origin ? (isSeparating ? "Separating…" : "Separate them instead") : undefined}
        onSecondary={origin ? handleSeparate : undefined}
        secondaryDisabled={needsCategory && importedCategory === ""}
        onConfirm={handleDelete}
        onCancel={() => setConfirming(false)}
      >
        {origin?.kind === "import" ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`separate-cat-${origin.transferGroupId}`} className="text-sm text-ink-secondary">
              {importedCategoryLabel(origin)}
            </label>
            <select
              id={`separate-cat-${origin.transferGroupId}`}
              value={importedCategory}
              onChange={(e) => setImportedCategory(e.target.value)}
              className={FIELD_CLASS}
              required
            >
              <option value="">Choose a category…</option>
              {importedOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
