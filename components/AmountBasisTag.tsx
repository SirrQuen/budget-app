import { amountBasisLabel, type AmountBasis } from "@/lib/amountBasis";

// "(average of last 3)" beside an upcoming amount -- what it rests on, so
// the user can judge it (lib/amountBasis.ts). Every upcoming amount
// carries one, a fixed one included. Muted ink, never a data or status
// colour: provenance, not a warning.
export function AmountBasisTag({ basis, className = "" }: { basis: AmountBasis; className?: string }) {
  return <span className={`text-xs font-normal text-ink-muted ${className}`}>({amountBasisLabel(basis)})</span>;
}
