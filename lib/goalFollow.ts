import { formatCurrency } from "@/lib/format";

// Copy for a debt payoff goal that follows a card (migration 70;
// docs/Log-Again-and-Goal-Links.md, section 2). Linking says what happens
// to the money already logged against the goal before it happens: it
// stays as history, uncounted, and the card's balance takes over.

/** "Your 4 payments ($900) stay in its history. From now on the goal follows Visa's balance." */
export function historySentence(count: number, total: number, cardName: string): string {
  if (count === 0) return `From now on the goal follows ${cardName}'s balance.`;
  const payments = count === 1 ? "Your 1 payment" : `Your ${count} payments`;
  const stay = count === 1 ? "stays" : "stay";
  return `${payments} (${formatCurrency(total)}) ${stay} in its history. From now on the goal follows ${cardName}'s balance.`;
}

/** The note beside the Goal field when a transaction touches a followed card. */
export function followedNote(goalName: string): string {
  return `${goalName} follows the card's balance, so payments count automatically.`;
}
