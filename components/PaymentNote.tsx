import { InfoIcon } from "@/components/ui/icons";
import type { PaymentPayee } from "@/lib/accountOptions";

const HOW_TO_PAY: Record<"card" | "loan" | "both", string> = {
  card: "pay the card through your bank or card issuer.",
  loan: "pay the loan through your bank or lender.",
  both: "pay each one through your bank, card issuer or lender.",
};

// Sorrel has no bank connection, so recording a payment changes only
// Sorrel's figures. Someone who believes they paid a card or loan here,
// and didn't, pays a late fee and interest -- so wherever a payment to
// one is recorded or its amount confirmed, this sits next to the action,
// on every route: the transaction form's Transfer, the confirmation queue
// (a row, Confirm all), its "It was different" sheet, and the statement-
// amount sheet. Permanent and not dismissible; neutral ink, not a status
// colour: a fact, not an alarm. Who gets it is paymentPayee's call
// (lib/accountOptions.ts), never the caller's.
export function PaymentNote({ payees, className = "" }: { payees: readonly PaymentPayee[]; className?: string }) {
  const has = (p: PaymentPayee) => payees.includes(p);
  const which = has("card") && has("loan") ? "both" : has("loan") ? "loan" : has("card") ? "card" : null;
  if (which === null) return null;
  return (
    <p className={`flex items-start gap-2 text-xs text-ink-secondary ${className}`}>
      <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
      <span className="flex-1">
        Recording a payment here updates Sorrel. It doesn&apos;t move any money — {HOW_TO_PAY[which]}
      </span>
    </p>
  );
}
