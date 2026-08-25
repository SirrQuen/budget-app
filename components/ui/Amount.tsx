import { formatSignedAmount, type Tone } from "@/lib/format";

// The only place a Tone maps to a colour class -- every other component
// that needs tone-coloured text (Amount itself, or a precomputed tone from
// formatDelta) goes through toneClassName rather than keeping its own copy.
const TONE_CLASS: Record<Tone, string> = {
  good: "text-good",
  critical: "text-critical",
  neutral: "text-ink",
};

export function toneClassName(tone: Tone): string {
  return TONE_CLASS[tone];
}

/**
 * Formats and colours a signed transaction amount in one place -- callers
 * never touch formatSignedAmount or a tone->class map directly. Expense
 * stays neutral (plain ink, same weight as any other value); income reads
 * good.
 */
export function Amount({
  amount,
  type,
  column = false,
  className = "",
}: {
  amount: number;
  type: "Income" | "Expense";
  /** Inside a table cell that needs vertical alignment -- tabular-nums
   * there. Everywhere else stays proportional, per the design language's
   * "big standalone numbers use proportional figures" rule. */
  column?: boolean;
  className?: string;
}) {
  const { text, tone } = formatSignedAmount(amount, type);
  return (
    <span className={`font-medium ${column ? "tabular-nums" : ""} ${toneClassName(tone)} ${className}`}>
      {text}
    </span>
  );
}
