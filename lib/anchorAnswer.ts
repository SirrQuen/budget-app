// The pre-anchor question (migration 62): a transaction dated before its
// account's balance date asks "Was it already included in that balance?"
//
//   Yes, it's already counted   counts_despite_anchor = false
//   No, add it to my balance    counts_despite_anchor = true
//
// stored with the opening_set_at of the anchor it answered. Whether the
// question applies is SQL's answer (balance_anchor_preview, through
// anchor_includes()), never worked out here; this module only names the
// form fields and reads them back. The database requires the answer
// (trg_transactions_anchor_answer), so a form that skipped it is refused
// there, not silently saved.
//
// AN OVERRIDE IS VALID ONLY AGAINST THE ANCHOR IT ANSWERED: setting a new
// balance supersedes it. The rule checks that in SQL; storedAnswerApplies
// is only for saying so on screen.

/** What balance_anchor_preview returns for one account and date. */
export type AnchorPreview = {
  /** The date rule alone. false = the question applies. */
  countsByDate: boolean;
  /** opening_balance, dollars. Negative for a liability. */
  anchorBalance: number;
  anchorDate: string;
  /** What an answer is stored against. */
  anchorSetAt: string;
  accountType: string;
};

/** The two stored columns. Both null when nothing was asked. */
export type AnchorAnswer = {
  counts_despite_anchor: boolean;
  anchor_answer_set_at: string;
};

export type AnchorAnswerColumns = {
  counts_despite_anchor: boolean | null;
  anchor_answer_set_at: string | null;
};

/** One answer per account a write lands on -- a transfer has two. */
export type AnchorAnswersByAccount = Record<string, AnchorAnswerColumns>;

export const NO_ANCHOR_ANSWER: AnchorAnswerColumns = {
  counts_despite_anchor: null,
  anchor_answer_set_at: null,
};

export type AnchorChoice = "counted" | "add";

/** Radio group name for one account's answer. */
export function anchorChoiceField(accountId: string): string {
  return `anchor_choice.${accountId}`;
}

/** Hidden field carrying the opening_set_at the person was shown. */
export function anchorSetAtField(accountId: string): string {
  return `anchor_set_at.${accountId}`;
}

/**
 * Reads one account's answer from a submitted form. Absent (no question
 * shown, or not answered) reads as no answer; the database decides
 * whether one was needed.
 */
export function parseAnchorAnswer(formData: FormData, accountId: string): AnchorAnswerColumns {
  if (!accountId) return NO_ANCHOR_ANSWER;
  const choice = formData.get(anchorChoiceField(accountId));
  const setAt = String(formData.get(anchorSetAtField(accountId)) ?? "").trim();
  if ((choice !== "counted" && choice !== "add") || setAt === "") {
    return NO_ANCHOR_ANSWER;
  }
  return { counts_despite_anchor: choice === "add", anchor_answer_set_at: setAt };
}

/**
 * Every answer in a submitted form, by account id -- for a write whose
 * accounts the server reads itself (a recurring confirmation). An answer
 * for an account the write doesn't touch is simply never used.
 */
export function parseAnchorAnswers(formData: FormData): AnchorAnswersByAccount {
  const prefix = anchorChoiceField("");
  const answers: AnchorAnswersByAccount = {};
  for (const key of formData.keys()) {
    if (!key.startsWith(prefix)) continue;
    const accountId = key.slice(prefix.length);
    const answer = parseAnchorAnswer(formData, accountId);
    if (answer.counts_despite_anchor !== null) answers[accountId] = answer;
  }
  return answers;
}

/** The stored answer as a choice, or null when there is none. */
export function storedChoice(columns: AnchorAnswerColumns): AnchorChoice | null {
  if (columns.counts_despite_anchor === null) return null;
  return columns.counts_despite_anchor ? "add" : "counted";
}

/**
 * Does a stored answer still apply -- was it given against the account's
 * current anchor? Compared as instants, since the two strings can arrive
 * in different offsets.
 */
export function storedAnswerApplies(columns: AnchorAnswerColumns, anchorSetAt: string): boolean {
  if (columns.anchor_answer_set_at === null) return false;
  return Date.parse(columns.anchor_answer_set_at) === Date.parse(anchorSetAt);
}

// The two SQLSTATEs trg_transactions_anchor_answer raises (migration 62).
export const ANCHOR_ANSWER_REQUIRED_CODE = "SRA01";
export const ANCHOR_ANSWER_STALE_CODE = "SRA02";

export const ANCHOR_ANSWER_REQUIRED =
  "This is dated before your balance date. Say whether that balance already included it.";
export const ANCHOR_ANSWER_STALE =
  "That account's balance changed since you answered. Answer again for the new balance.";

/** True for either message above -- the write needs (another) answer. */
export function needsAnchorAnswer(error: string | null | undefined): boolean {
  return error === ANCHOR_ANSWER_REQUIRED || error === ANCHOR_ANSWER_STALE;
}
