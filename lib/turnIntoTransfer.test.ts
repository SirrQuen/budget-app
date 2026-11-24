import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bothEntriesSentence,
  bulkOriginWarning,
  directionLabel,
  importedCategoryLabel,
  keptEntryId,
  separateSentence,
  separatesSentence,
  turnPlan,
  type TransferOrigin,
} from "./turnIntoTransfer";
import type { TransferMatch } from "./importTransfers";

// "Turn into a transfer" and separating (migration 80; rulings of
// 2026-11-24). The database does the writing; these are the words and
// the plan the screens show.

const created: TransferOrigin = {
  kind: "conversion",
  transferGroupId: "g1",
  source: { id: "s", description: "ONLINE TRANSFER", accountName: "Checking", type: "Expense" },
  sourceCategory: "Groceries",
  other: { id: "c", description: "ONLINE TRANSFER", accountName: "Savings", type: "Income" },
  otherCategory: null,
  edited: false,
};
const joined: TransferOrigin = {
  ...created,
  transferGroupId: "g2",
  other: { id: "j", description: "Visa payment by hand", accountName: "Visa", type: "Income" },
  otherCategory: "Other Income",
};
const imported: TransferOrigin = {
  kind: "import",
  transferGroupId: "g3",
  kept: { id: "k", description: "Visa payment by hand", accountName: "Visa", type: "Income" },
  keptCategory: "Other Income",
  imported: { id: "i", description: "AUTOPAY PAYMENT", accountName: "Checking", type: "Expense" },
  edited: false,
};

test("the delete dialog names both entries", () => {
  assert.equal(bothEntriesSentence(created), "This removes both entries: “ONLINE TRANSFER” on Checking and “ONLINE TRANSFER” on Savings.");
  assert.equal(bothEntriesSentence(imported), "This removes both entries: “AUTOPAY PAYMENT” on Checking and “Visa payment by hand” on Visa.");
});

test("separating says what comes back and what goes, for each kind", () => {
  assert.equal(
    separateSentence(created),
    "Separating puts “ONLINE TRANSFER” back in Groceries and removes the entry added on Savings.",
  );
  assert.equal(
    separateSentence(joined),
    "Separating puts both back as they were: “ONLINE TRANSFER” in Groceries and “Visa payment by hand” in Other Income.",
  );
  assert.equal(
    separateSentence(imported),
    "Separating puts “Visa payment by hand” on Visa back in Other Income, as it was before the import, and keeps “AUTOPAY PAYMENT” on Checking as an entry of its own. Neither balance changes.",
  );
});

test("edits made since are kept, and the dialog says so (ruling 2)", () => {
  assert.match(separateSentence({ ...joined, edited: true }, "Undo"), /^Undo puts both back.* Edits made since are kept\.$/);
  assert.doesNotMatch(separateSentence(joined), /Edits/);
});

test("an import's side stays, and the dialog asks its category (ruled 2026-11-24)", () => {
  assert.equal(
    importedCategoryLabel(imported as Extract<TransferOrigin, { kind: "import" }>),
    "This entry from your Checking file needs a category to stand on its own",
  );
  assert.doesNotMatch(separateSentence(imported), /remove/i);
});

test("bulk delete warns when the selection holds transfers made from entries", () => {
  assert.equal(bulkOriginWarning(0), null);
  assert.equal(
    bulkOriginWarning(1),
    "1 of them was made from entries you already had. To keep those entries, open it and choose Separate instead.",
  );
  assert.equal(
    bulkOriginWarning(3),
    "3 of them were made from entries you already had. To keep those entries, open each and choose Separate instead.",
  );
  // No dash of either kind: the dialog's first sentence already uses "--".
  assert.doesNotMatch(bulkOriginWarning(1)! + bulkOriginWarning(3)!, /—|--/);
});

test("after separating, the editor goes to the entry that stays", () => {
  assert.equal(keptEntryId(created), "s");
  assert.equal(keptEntryId(imported), "k");
});

test("undo-import's line counts the transfers it separates", () => {
  assert.equal(separatesSentence(0), null);
  assert.equal(separatesSentence(1), "This also separates 1 transfer made from these rows.");
  assert.equal(separatesSentence(2), "This also separates 2 transfers made from these rows.");
});

const match = (pairable: boolean): TransferMatch => ({
  candidate: { id: "m", accountId: "visa", date: "2026-11-19", cents: 8000, type: "Income", description: "x", pairable },
  gapDays: 0,
});

test("the plan: a joinable entry is asked about, never assumed", () => {
  assert.deepEqual(turnPlan("", undefined, undefined), { step: "choose" });
  assert.equal(turnPlan("visa", match(true), undefined).step, "ask");
  assert.equal(turnPlan("visa", match(true), "pair").step, "join");
  assert.deepEqual(turnPlan("visa", match(true), "new"), { step: "create", blocked: null });
  assert.deepEqual(turnPlan("sav", undefined, undefined), { step: "create", blocked: null });
  // One that can't be joined is said, and the other side is added.
  const blocked = match(false);
  assert.deepEqual(turnPlan("visa", blocked, undefined), { step: "create", blocked });
});

test("the account picker reads the way the money went", () => {
  assert.equal(directionLabel("Expense"), "Transfer to");
  assert.equal(directionLabel("Income"), "Transfer from");
});
