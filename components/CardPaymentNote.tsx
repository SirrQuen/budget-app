import { InfoIcon } from "@/components/ui/icons";

// Sorrel has no bank connection, so recording a card payment changes only
// Sorrel's figures. Someone who believes they paid the card here, and
// didn't, pays a late fee and interest -- so wherever a payment to a
// credit card is recorded, this sits next to the action. Permanent and
// not dismissible; neutral ink, not a status colour: a fact, not an alarm.
// The same line on every surface: the transaction form's Transfer, the
// confirmation queue (a row, Confirm all) and its "It was different" sheet.
export function CardPaymentNote({ className = "" }: { className?: string }) {
  return (
    <p className={`flex items-start gap-2 text-xs text-ink-secondary ${className}`}>
      <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
      <span className="flex-1">
        Recording a payment here updates Sorrel. It doesn&apos;t move any money — pay the card through your
        bank or card issuer.
      </span>
    </p>
  );
}
