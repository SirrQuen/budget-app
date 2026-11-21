import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_HISTORY_KEYS,
  TRANSFER_MATCH_DAYS,
  buildCategoryHistory,
  findTransferMatches,
  historyMap,
  merchantKey,
  resolveRowCategories,
  sameBillRows,
  sameMerchantRows,
  suggestCategory,
  transferWording,
  type TransferCandidate,
} from "./importTransfers";

// Transfers and per-row categories in the import preview (migration 76,
// docs/Import-CSV.md). All of it runs on the device.

test("the wording banks use for a transfer is flagged, and ordinary spending isn't", () => {
  for (const d of [
    "ONLINE TRANSFER TO SAV 1234",
    "Transfer from Checking",
    "XFER TO SAVINGS",
    "PAYMENT THANK YOU",
    "Payment - Thank You",
    "AUTOPAY PAYMENT VISA",
    "CHASE CREDIT CARD PAYMENT",
  ]) {
    assert.equal(transferWording(d), true, d);
  }
  for (const d of ["TESCO STORES 1234", "TRANSFERWISE FEE", "Payroll ACME", "Coffee"]) {
    assert.equal(transferWording(d), false, d);
  }
});

const cand = (over: Partial<TransferCandidate>): TransferCandidate => ({
  id: "c1",
  accountId: "sav",
  date: "2026-11-03",
  cents: 50000,
  type: "Income",
  description: "From checking",
  pairable: true,
  ...over,
});
const row = (over: Partial<{ row: number; type: "Income" | "Expense"; date: string; cents: number; otherAccountId: string | null }> = {}) => ({
  row: 2,
  type: "Expense" as const,
  date: "2026-11-03",
  cents: 50000,
  otherAccountId: null,
  ...over,
});

test("the other side: opposite direction, exact cents, within 5 days", () => {
  assert.equal(TRANSFER_MATCH_DAYS, 5);
  assert.equal(findTransferMatches([row()], [cand({})]).get(2)?.candidate.id, "c1");
  assert.equal(findTransferMatches([row()], [cand({ type: "Expense" })]).size, 0, "same direction");
  assert.equal(findTransferMatches([row()], [cand({ cents: 50001 })]).size, 0, "a cent off");
  // Friday to Wednesday is 5 days; 6 is too far.
  assert.equal(findTransferMatches([row({ date: "2026-11-06" })], [cand({ date: "2026-11-11" })]).size, 1);
  assert.equal(findTransferMatches([row({ date: "2026-11-06" })], [cand({ date: "2026-11-12" })]).size, 0);
  assert.equal(findTransferMatches([row({ date: "2026-11-06" })], [cand({ date: "2026-11-01" })]).size, 1);
});

test("a chosen other account limits the match to it", () => {
  const visa = cand({ id: "v", accountId: "visa" });
  assert.equal(findTransferMatches([row({ otherAccountId: "sav" })], [visa]).size, 0);
  assert.equal(findTransferMatches([row({ otherAccountId: "visa" })], [visa]).get(2)?.candidate.id, "v");
});

test("each entry is claimed once: two $500 transfers find two different entries, closest first", () => {
  const a = cand({ id: "a", date: "2026-11-03" });
  const b = cand({ id: "b", date: "2026-11-10" });
  const m = findTransferMatches([row({ row: 2, date: "2026-11-09" }), row({ row: 3, date: "2026-11-03" })], [a, b]);
  assert.equal(m.get(3)?.candidate.id, "a");
  assert.equal(m.get(2)?.candidate.id, "b");
  const one = findTransferMatches([row({ row: 2 }), row({ row: 3 })], [a]);
  assert.equal(one.size, 1);
  assert.equal(one.get(2)?.candidate.id, "a", "ties go to the earlier file row");
});

test("same-bill rows: a created transfer carries its other account; a joined one is left out", () => {
  const base = { type: "Expense" as const, date: "2026-11-03", cents: 100 };
  assert.deepEqual(
    sameBillRows([
      { row: 2, ...base, transfer: null },
      { row: 3, ...base, transfer: { otherAccountId: "sav", pairWith: null } },
      { row: 4, ...base, transfer: { otherAccountId: "visa", pairWith: "t1" } },
    ]).map((r) => [r.row, r.transferOtherAccountId]),
    [
      [2, null],
      [3, "sav"],
    ],
  );
});

test("merchant keys drop card words, store numbers and punctuation", () => {
  assert.equal(merchantKey("SQ *BLUE BOTTLE 0423 OAKLAND"), "BLUE BOTTLE");
  assert.equal(merchantKey("Blue Bottle #19"), "BLUE BOTTLE");
  assert.equal(merchantKey("POS DEBIT TESCO STORES 1234"), "TESCO STORES");
  assert.equal(merchantKey("Trader Joe's"), "TRADER JOES");
  assert.equal(merchantKey("12345 678"), null);
});

test("history: each merchant's most-used active category per type, capped", () => {
  const active = new Set(["groc", "cafe", "pay"]);
  const h = buildCategoryHistory(
    [
      { description: "TESCO STORES 1", categoryId: "groc", type: "Expense" },
      { description: "Tesco Stores 2", categoryId: "groc", type: "Expense" },
      { description: "TESCO STORES 3", categoryId: "cafe", type: "Expense" },
      { description: "ACME PAYROLL", categoryId: "pay", type: "Income" },
      { description: "OLD SHOP", categoryId: "archived", type: "Expense" },
    ],
    active,
  );
  const map = historyMap(h);
  assert.equal(suggestCategory(map, "TESCO STORES 999", "Expense"), "groc");
  assert.equal(suggestCategory(map, "TESCO STORES 999", "Income"), undefined, "per type");
  assert.equal(suggestCategory(map, "ACME PAYROLL NOV", "Income"), "pay");
  assert.equal(suggestCategory(map, "OLD SHOP", "Expense"), undefined, "archived categories don't count");

  const many = Array.from({ length: MAX_HISTORY_KEYS + 50 }, (_, i) => ({
    description: `SHOP ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26) % 26)}${String.fromCharCode(65 + Math.floor(i / 676))}`,
    categoryId: "groc",
    type: "Expense" as const,
  }));
  assert.equal(buildCategoryHistory(many, active).length, MAX_HISTORY_KEYS);
});

test("a row's category: chosen, else the file's, else a suggestion -- always its own type; a transfer has none", () => {
  const types = new Map<string, "Income" | "Expense">([
    ["groc", "Expense"],
    ["cafe", "Expense"],
    ["pay", "Income"],
  ]);
  const history = new Map([["Expense|BLUE BOTTLE", "cafe"]]);
  const rows = [
    { row: 2, type: "Expense" as const, transfer: false, description: "BLUE BOTTLE 1", fileCategoryId: null },
    { row: 3, type: "Expense" as const, transfer: false, description: "BLUE BOTTLE 2", fileCategoryId: "groc" },
    { row: 4, type: "Expense" as const, transfer: false, description: "UNKNOWN", fileCategoryId: null },
    { row: 5, type: "Income" as const, transfer: false, description: "BLUE BOTTLE REFUND", fileCategoryId: null },
    { row: 6, type: "Expense" as const, transfer: true, description: "XFER", fileCategoryId: null },
    { row: 7, type: "Income" as const, transfer: false, description: "X", fileCategoryId: null },
  ];
  const { byRow, missing } = resolveRowCategories(rows, types, new Map([[7, "groc"], [4, "groc"]]), history);
  assert.deepEqual(byRow.get(2), { id: "cafe", source: "suggested" });
  assert.deepEqual(byRow.get(3), { id: "groc", source: "file" });
  assert.deepEqual(byRow.get(4), { id: "groc", source: "chosen" });
  assert.equal(byRow.has(6), false, "a transfer has no category");
  // An Income row can't take an Expense category, chosen or suggested.
  assert.deepEqual(missing, [5, 7]);
});

test("the same-merchant shortcut finds the other rows of that merchant and type not already in it", () => {
  const rows = [
    { row: 2, type: "Expense" as const, transfer: false, description: "TESCO STORES 1" },
    { row: 3, type: "Expense" as const, transfer: false, description: "TESCO STORES 2" },
    { row: 4, type: "Expense" as const, transfer: false, description: "Tesco Stores 3" },
    { row: 5, type: "Income" as const, transfer: false, description: "TESCO STORES REFUND" },
    { row: 6, type: "Expense" as const, transfer: true, description: "TESCO STORES XFER" },
    { row: 7, type: "Expense" as const, transfer: false, description: "SAINSBURYS" },
  ];
  const current = new Map([[4, { id: "groc", source: "chosen" as const }]]);
  assert.deepEqual(
    sameMerchantRows({ row: 2, type: "Expense", description: "TESCO STORES 1", categoryId: "groc" }, rows, current),
    { merchant: "TESCO STORES", rows: [3] },
  );
  assert.equal(sameMerchantRows({ row: 7, type: "Expense", description: "SAINSBURYS", categoryId: "groc" }, rows, current), null);
});
