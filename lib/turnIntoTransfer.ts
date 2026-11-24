// "Turn into a transfer" (migration 80) and the two kinds of transfer that
// can be separated again: one the person made from an entry, and one an
// import joined to an entry they already had (migration 76). Pure, so the
// words and the plan are tested without a browser or a database
// (lib/turnIntoTransfer.test.ts). The database decides everything that
// matters; this only says it.

import type { ImportType } from "@/lib/importCsv";
import type { TransferMatch } from "@/lib/importTransfers";

/** One leg as the dialogs name it: "“ONLINE TRANSFER” on Checking". */
export type OriginLeg = { id: string; description: string; accountName: string; type: ImportType };

/**
 * Where a transfer came from, when it can be separated again.
 *
 *   conversion   "Turn into a transfer": `source` is the entry it was made
 *                from (back to `sourceCategory`); `other` is the entry it
 *                joined (back to `otherCategory`) or the leg it added
 *                (`otherCategory` null -- it goes).
 *   import       an import joined `kept`, an entry the person already had
 *                (back to `keptCategory`), to the side it imported
 *                (`imported`). That side is real bank data, so it STAYS
 *                and needs a category the person chooses (ruled
 *                2026-11-24).
 *
 * `edited`: a leg changed after the transfer was made. Separating keeps
 * those edits (ruling 2026-11-24), and the dialog says so.
 */
export type TransferOrigin =
  | {
      kind: "conversion";
      transferGroupId: string;
      source: OriginLeg;
      sourceCategory: string;
      other: OriginLeg;
      otherCategory: string | null;
      edited: boolean;
    }
  | {
      kind: "import";
      transferGroupId: string;
      kept: OriginLeg;
      keptCategory: string;
      imported: OriginLeg;
      edited: boolean;
    };

/** The entry that remains after separating: where the editor goes next. */
export function keptEntryId(o: TransferOrigin): string {
  return o.kind === "conversion" ? o.source.id : o.kept.id;
}

const q = (s: string) => `“${s}”`;
const on = (l: OriginLeg) => `${q(l.description)} on ${l.accountName}`;

/** The delete dialog's first sentence: both entries, named. */
export function bothEntriesSentence(o: TransferOrigin): string {
  const [a, b] = o.kind === "conversion" ? [o.source, o.other] : [o.imported, o.kept];
  return `This removes both entries: ${on(a)} and ${on(b)}.`;
}

/** What separating does, said before it's done. `lead` is "Separating" or "Undo". */
export function separateSentence(o: TransferOrigin, lead: "Separating" | "Undo" = "Separating"): string {
  const edits = o.edited ? " Edits made since are kept." : "";
  if (o.kind === "import") {
    return `${lead} puts ${on(o.kept)} back in ${o.keptCategory}, as it was before the import, and keeps ${on(o.imported)} as an entry of its own. Neither balance changes.${edits}`;
  }
  if (o.otherCategory === null) {
    return `${lead} puts ${q(o.source.description)} back in ${o.sourceCategory} and removes the entry added on ${o.other.accountName}.${edits}`;
  }
  return `${lead} puts both back as they were: ${q(o.source.description)} in ${o.sourceCategory} and ${q(o.other.description)} in ${o.otherCategory}.${edits}`;
}

/** The label over the category the imported side needs to stand on its own. */
export function importedCategoryLabel(o: Extract<TransferOrigin, { kind: "import" }>): string {
  return `This entry from your ${o.imported.accountName} file needs a category to stand on its own`;
}

/**
 * Bulk delete can't separate (queued): when the selection includes
 * transfers made from entries or joined by an import, its dialog says
 * how to keep those entries. The sentence before it already says a
 * transfer's other side goes too, so this doesn't repeat it. Null for none.
 */
export function bulkOriginWarning(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 of them was made from entries you already had. To keep those entries, open it and choose Separate instead."
    : `${count} of them were made from entries you already had. To keep those entries, open each and choose Separate instead.`;
}

/** "Undo this import": "This also separates 2 transfers made from these rows." Null for none. */
export function separatesSentence(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "This also separates 1 transfer made from these rows."
    : `This also separates ${count} transfers made from these rows.`;
}

/**
 * What the editor's "Turn into a transfer" will do once an account is
 * chosen: join an entry already there (asked, never assumed), or add the
 * other side.
 *
 *   choose   no account yet
 *   ask      a joinable entry there; the person hasn't said yes or no
 *   join     they said yes
 *   create   no joinable entry, or they said no
 */
export type TurnPlan =
  | { step: "choose" }
  | { step: "ask"; match: TransferMatch }
  | { step: "join"; match: TransferMatch }
  | { step: "create"; blocked: TransferMatch | null };

export function turnPlan(
  otherAccountId: string,
  match: TransferMatch | undefined,
  pairAnswer: "pair" | "new" | undefined,
): TurnPlan {
  if (otherAccountId === "") return { step: "choose" };
  if (match && match.candidate.pairable) {
    if (pairAnswer === undefined) return { step: "ask", match };
    if (pairAnswer === "pair") return { step: "join", match };
    return { step: "create", blocked: null };
  }
  // A match that can't be joined (a schedule, a goal, a same-bill answer)
  // is said, and the other side is added beside it.
  return { step: "create", blocked: match ?? null };
}

/** "Transfer to" for money out, "Transfer from" for money in. */
export function directionLabel(type: ImportType): "Transfer to" | "Transfer from" {
  return type === "Expense" ? "Transfer to" : "Transfer from";
}
