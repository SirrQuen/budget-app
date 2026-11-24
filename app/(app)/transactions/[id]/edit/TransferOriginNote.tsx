"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { separateTransferAction } from "@/lib/actions/transferConversions";
import { callAction } from "@/components/useActionForm";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { InfoIcon } from "@/components/ui/icons";
import { keptEntryId, separateSentence, type TransferOrigin } from "@/lib/turnIntoTransfer";

// On a transfer the person made from an entry ("Turn into a transfer",
// migration 80): where it came from, and Undo. Undo stays as long as the
// transfer does; after edits it still works and keeps them (ruling
// 2026-11-24), and the dialog says so. Not a status: neutral ink and an
// info icon.
// `forecastNote` is the delete dialog's same-bill line (sameBillDeleteNote):
// Undo removes the added side as delete does, so a schedule's occurrence
// it filled comes back -- or doesn't -- on the same rule
// (undo_make_transfer, same_bill_restores()).
export function TransferOriginNote({
  origin,
  forecastNote,
}: {
  origin: Extract<TransferOrigin, { kind: "conversion" }>;
  forecastNote?: string;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string>();
  const [undoing, startUndo] = useTransition();

  function undo() {
    startUndo(async () => {
      const result = await callAction(() => separateTransferAction(origin.transferGroupId, "conversion"));
      setAsking(false);
      if (result.error !== undefined) {
        setError(result.error);
        return;
      }
      // The open leg may be the one Undo removes: go to the entry that stays.
      router.replace(`/transactions/${keptEntryId(origin)}/edit`);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-secondary">
      <InfoIcon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
      <span>
        You turned “{origin.source.description}” ({origin.sourceCategory}) into this transfer.
      </span>
      <button
        type="button"
        onClick={() => {
          setError(undefined);
          setAsking(true);
        }}
        className="inline-flex min-h-11 items-center rounded text-sm font-medium text-action hover:text-action-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
      >
        Undo
      </button>
      {error ? (
        <span role="alert" className="text-sm text-critical">
          {error}
        </span>
      ) : null}
      <ConfirmDialog
        open={asking}
        title="Undo this transfer?"
        description={forecastNote ? `${separateSentence(origin, "Undo")} ${forecastNote}` : separateSentence(origin, "Undo")}
        confirmLabel={undoing ? "Undoing…" : "Undo"}
        busy={undoing}
        onConfirm={undo}
        onCancel={() => setAsking(false)}
      />
    </div>
  );
}
