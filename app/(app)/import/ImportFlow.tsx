"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getImportContextAction, importTransactionsAction } from "@/lib/actions/import";
import type { ImportContext, OtherAccount } from "@/lib/db/imports";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  accountsInExport,
  countDataRecords,
  detectDateOrder,
  guessColumns,
  isSorrelExport,
  moneyOutExample,
  preselectExportAccount,
  readRows,
  readSorrelExport,
  type ColumnMap,
  type DateOrder,
  type ExportAccount,
  type ImportType,
  type MoneyOut,
  type ReadResult,
  type ReadRow,
  type Records,
} from "@/lib/importCsv";
import {
  choiceToCountsDespiteAnchor,
  findDuplicates,
  matchCategories,
  summarizeImport,
  type DateTreatment,
  type ImportSummary,
  type PreAnchorChoice,
} from "@/lib/importReview";
import {
  findTransferMatches,
  historyMap,
  resolveRowCategories,
  sameBillRows,
  sameMerchantRows,
  transferWording,
  type RowCategory,
  type TransferMatch,
} from "@/lib/importTransfers";
import { findImportSameBill } from "@/lib/sameBill";
import { importedThroughSentence } from "@/lib/importedThrough";
import { formatAccountBalance, formatCurrency, formatDate, formatDayMonth } from "@/lib/format";
import { Amount } from "@/components/ui/Amount";
import { Button, buttonClass } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { FIELD_CLASS } from "@/components/ui/Input";
import { InfoIcon } from "@/components/ui/icons";
import { useShowGoalCompletion } from "@/components/GoalCompletionHost";
import { UndoImportButton } from "./UndoImportButton";

// Import (docs/Import-CSV.md). The file is read HERE, in the browser: no
// upload, no filename kept (it isn't even held in state), nothing logged.
// Its descriptions and amounts stay on this device until the person
// presses Import. The server hears from this component twice:
//
//   1. getImportContextAction(account, DATES) -- the preview's question.
//      Distinct dates and the account id, no descriptions, no amounts. What
//      comes back is the person's own data: balances, how each date sits
//      against each account's balance date, recent entries on their other
//      accounts (a transfer's other side) and their usual categories. The
//      file is matched against those HERE (lib/importTransfers.ts).
//   2. importTransactionsAction(...) -- once, after the person presses
//      Import, with only the rows they confirmed.
//
// Nothing is saved before step 2. The preview shows what step 2 will do to
// every balance it touches, from the database's rule (import_preview ->
// counts_in_balance); this file only applies the person's answers and adds
// up integer cents.
//
// Answers REQUIRED with no default: which way money goes (a one-column
// amount), the date format (when every date could be read either way),
// whether rows before a balance date were already in that balance (per
// account), each "same bill" and "make them one transfer" question, every
// row's category (but a transfer's) and every transfer's other account.

export type ImportAccount = { id: string; name: string; type: string };

/** A row's kind, as the person sets it: Spending and Income are Expense and Income. */
type RowKind = ImportType | "Transfer";

type Cols = {
  date: number | null;
  description: number | null;
  shape: "signed" | "split";
  amount: number | null;
  debit: number | null;
  credit: number | null;
  category: number | null;
  notes: number | null;
};

const CARD = "rounded-2xl border border-hairline bg-surface p-5";
const H2 = "text-base font-semibold text-ink";
const SUB = "mt-1 max-w-prose text-sm text-ink-secondary";
const CHOICE =
  "flex min-h-11 flex-1 cursor-pointer items-center gap-2 rounded-lg border border-field-border px-3 py-2 text-sm text-ink transition-colors duration-150 hover:bg-surface has-[:checked]:border-action has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-action";
const SMALL_FIELD = `${FIELD_CLASS} sm:max-w-56`;
const SHOW_ROWS = 200;
const SHOW_UNREADABLE = 50;

const dollars = (cents: number) => cents / 100;
const flip = (t: ImportType): ImportType => (t === "Expense" ? "Income" : "Expense");

function emptyCols(header: readonly string[]): Cols {
  const g = guessColumns(header);
  const split = g.amount === null && g.debit !== null && g.credit !== null;
  return {
    date: g.date,
    description: g.description,
    shape: split ? "split" : "signed",
    amount: g.amount,
    debit: g.debit,
    credit: g.credit,
    category: g.category,
    notes: g.notes,
  };
}

function toMap(c: Cols): ColumnMap | null {
  if (c.date === null || c.description === null) return null;
  if (c.shape === "signed") {
    if (c.amount === null) return null;
    return { date: c.date, description: c.description, amount: { kind: "signed", column: c.amount }, category: c.category, notes: c.notes };
  }
  if (c.debit === null || c.credit === null || c.debit === c.credit) return null;
  return { date: c.date, description: c.description, amount: { kind: "split", debit: c.debit, credit: c.credit }, category: c.category, notes: c.notes };
}

/** What the preview knows about one row, worked out from the file, the context and the answers. */
type RowView = {
  r: ReadRow;
  included: boolean;
  kind: RowKind;
  /** Spending or income; for a transfer, which way it moved on THIS account. */
  type: ImportType;
  category: RowCategory | undefined;
  /** A transfer's other account (chosen, from the export, or from a match); null until there is one. */
  otherAccountId: string | null;
  /** The matching entry on the other account, if any. */
  match: TransferMatch | undefined;
  /** The entry this row joins: a "Yes" to a joinable match. */
  pairWith: string | null;
  /** A joinable match the person hasn't answered yet. */
  pairUnanswered: boolean;
  looksLikeTransfer: boolean;
};

export function ImportFlow({
  accounts,
  initialAccountId,
  today,
  importedThrough,
}: {
  accounts: ImportAccount[];
  initialAccountId: string | null;
  today: string;
  /** Account id -> latest transaction date among its imported rows. */
  importedThrough: Record<string, string>;
}) {
  const [accountId, setAccountId] = useState(initialAccountId ?? "");
  const [records, setRecords] = useState<Records | null>(null);
  const [own, setOwn] = useState(false);
  const [fileError, setFileError] = useState<string>();
  const [attemptKey, setAttemptKey] = useState("");

  // Setup answers.
  const [cols, setCols] = useState<Cols | null>(null);
  const [moneyOut, setMoneyOut] = useState<MoneyOut | null>(null);
  const [orderChoice, setOrderChoice] = useState<DateOrder | null>(null);
  const [exportKey, setExportKey] = useState<string | null>(null);

  // The database's context for the dates in the file, keyed by what it was asked.
  const [ctx, setCtx] = useState<{ key: string; data: ImportContext } | null>(null);
  const [ctxError, setCtxError] = useState<{ key: string; message: string } | null>(null);

  // Review answers.
  const [preAnchor, setPreAnchor] = useState<PreAnchorChoice>(null);
  const [preAnchorOther, setPreAnchorOther] = useState<Record<string, PreAnchorChoice>>({});
  const [includeDup, setIncludeDup] = useState<Record<number, boolean>>({});
  const [rowKind, setRowKind] = useState<Record<number, RowKind>>({});
  const [rowCategory, setRowCategory] = useState<Record<number, string>>({});
  const [rowOther, setRowOther] = useState<Record<number, string>>({});
  const [pairAnswer, setPairAnswer] = useState<Record<number, "pair" | "new">>({});
  const [lastPick, setLastPick] = useState<{ row: number; categoryId: string } | null>(null);
  const [sameBill, setSameBill] = useState<Record<number, "same" | "different">>({});
  const [showAll, setShowAll] = useState(false);
  const [showAllUnreadable, setShowAllUnreadable] = useState(false);

  const [saving, startSave] = useTransition();
  const [saveError, setSaveError] = useState<string>();
  const [done, setDone] = useState<{ importId: string; rowCount: number; accountName: string; accountId: string } | null>(null);
  const showCompletion = useShowGoalCompletion();

  const account = accounts.find((a) => a.id === accountId) ?? null;
  const header = records?.[0] ?? [];

  function resetAnswers() {
    setPreAnchor(null);
    setPreAnchorOther({});
    setIncludeDup({});
    setRowKind({});
    setRowCategory({});
    setRowOther({});
    setPairAnswer({});
    setLastPick(null);
    setSameBill({});
  }

  // ---- the file ------------------------------------------------------

  async function onFile(file: File | undefined) {
    setFileError(undefined);
    setRecords(null);
    setCols(null);
    setCtx(null);
    setCtxError(null);
    setDone(null);
    setSaveError(undefined);
    if (!file) return;

    // The name is looked at, here, for its extension only -- never stored.
    if (/\.(xlsx|xlsm|xls|numbers|ods)$/i.test(file.name)) {
      setFileError("Sorrel reads CSV files. In Excel: File › Save As › CSV UTF-8.");
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setFileError("That file is larger than 5 MB. Split it into smaller files and import them one at a time.");
      return;
    }

    const text = await file.text();
    // PapaParse is loaded only when someone imports, and parses in this tab.
    const { default: Papa } = await import("papaparse");
    const parsed = Papa.parse(text, { skipEmptyLines: false });
    const data = parsed.data;
    if (parsed.errors.some((e) => e.type === "Quotes")) {
      setFileError("We couldn't read that as a CSV file: a quoted value isn't closed.");
      return;
    }
    if (data.length < 2 || (data[0]?.length ?? 0) < 2) {
      setFileError("We couldn't find columns and rows in that file. Is it a CSV with a header row?");
      return;
    }
    const count = countDataRecords(data);
    if (count === 0) {
      setFileError("That file has a header row but no transactions.");
      return;
    }
    if (count > MAX_IMPORT_ROWS) {
      setFileError(`That file has ${count.toLocaleString("en-US")} rows. An import takes at most 5,000, so split it and import it in parts.`);
      return;
    }

    const isOwn = isSorrelExport(data[0]);
    setOwn(isOwn);
    setRecords(data);
    setCols(isOwn ? null : emptyCols(data[0]));
    setMoneyOut(null);
    setOrderChoice(null);
    resetAnswers();
    setShowAll(false);
    setShowAllUnreadable(false);
    setAttemptKey(crypto.randomUUID());
    if (isOwn && account) {
      setExportKey(preselectExportAccount(accountsInExport(data), account));
    } else {
      setExportKey(null);
    }
  }

  function onAccount(id: string) {
    setAccountId(id);
    resetAnswers();
    const next = accounts.find((a) => a.id === id);
    if (own && records && next) setExportKey(preselectExportAccount(accountsInExport(records), next));
  }

  // ---- setup questions -----------------------------------------------

  const exportAccounts: ExportAccount[] = useMemo(() => (own && records ? accountsInExport(records) : []), [own, records]);
  const map = useMemo(() => (cols ? toMap(cols) : null), [cols]);
  const signed = cols?.shape === "signed";

  const dateFinding = useMemo(() => {
    if (!records || own || !cols || cols.date === null) return null;
    const col = cols.date;
    return detectDateOrder(records.slice(1).map((r) => r[col] ?? ""));
  }, [records, own, cols]);

  const order: DateOrder | null =
    dateFinding === null
      ? null
      : dateFinding.kind === "settled" || dateFinding.kind === "decided"
        ? dateFinding.order
        : dateFinding.kind === "ambiguous"
          ? orderChoice
          : null;
  const needOrder = dateFinding?.kind === "ambiguous" && orderChoice === null;
  const mixedDates = dateFinding?.kind === "mixed";
  const needMoneyOut = !own && signed === true && moneyOut === null;

  const example = useMemo(() => {
    if (!records || !cols || cols.shape !== "signed" || cols.amount === null || cols.description === null) return null;
    return moneyOutExample(records, cols.amount, cols.description);
  }, [records, cols]);

  const read: ReadResult | null = useMemo(() => {
    if (!records) return null;
    if (own) return readSorrelExport(records, { today });
    if (!map || needOrder || mixedDates || needMoneyOut) return null;
    return readRows(records, map, signed ? moneyOut : null, { today, order });
  }, [records, own, map, needOrder, mixedDates, needMoneyOut, signed, moneyOut, order, today]);

  // Rows for the chosen account. A Sorrel export names its accounts; the
  // person says which one this is.
  const scoped: ReadRow[] = useMemo(() => {
    if (!read) return [];
    if (!own) return read.rows;
    return exportKey === null ? [] : read.rows.filter((r) => r.accountKey === exportKey);
  }, [read, own, exportKey]);
  const notForThisAccount = own && read ? read.rows.length - scoped.length : 0;

  // A Sorrel export's transfer leg: its partner is the row in the file with
  // the same group id on another account. That account, mapped to one of
  // the person's by id, else by exact name; null leaves it to the person.
  const exportPartner = useMemo(() => {
    const found = new Map<number, string | null>();
    if (!own || !read) return found;
    for (const r of scoped) {
      if (r.transferGroupId === null) continue;
      const partner = read.rows.find((p) => p.transferGroupId === r.transferGroupId && p.accountKey !== r.accountKey);
      const inFile = partner ? exportAccounts.find((a) => a.key === partner.accountKey) : undefined;
      const mine = inFile
        ? (accounts.find((a) => a.id === inFile.id) ?? accounts.find((a) => a.name === inFile.name))
        : undefined;
      found.set(r.row, mine && mine.id !== accountId ? mine.id : null);
    }
    return found;
  }, [own, read, scoped, exportAccounts, accounts, accountId]);

  // ---- the database's answer about these dates -----------------------

  const dates = useMemo(() => [...new Set(scoped.map((r) => r.date))].sort(), [scoped]);
  const ctxKey = `${accountId}|${dates.join(",")}`;

  useEffect(() => {
    if (!accountId || dates.length === 0) return;
    let stale = false;
    getImportContextAction(accountId, dates).then((res) => {
      if (stale) return;
      if (res.error !== undefined) setCtxError({ key: ctxKey, message: res.error });
      else setCtx({ key: ctxKey, data: res.data });
    });
    return () => {
      stale = true;
    };
    // ctxKey is the account and the dates; the effect runs when either changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey]);

  const context = ctx && ctx.key === ctxKey ? ctx.data : null;
  const contextError = ctxError && ctxError.key === ctxKey ? ctxError.message : null;
  const loadingContext = dates.length > 0 && accountId !== "" && context === null && contextError === null;

  // ---- the review ----------------------------------------------------

  const dupes = useMemo(() => (context ? findDuplicates(scoped, context.existing) : new Map()), [context, scoped]);
  const included = useMemo(() => scoped.filter((r) => !dupes.has(r.row) || includeDup[r.row]), [scoped, dupes, includeDup]);
  const treatments = useMemo(() => new Map((context?.treatments ?? []).map((t) => [t.date, t])), [context]);
  const otherById = useMemo(() => new Map((context?.otherAccounts ?? []).map((a) => [a.id, a])), [context]);
  const categoryTypes = useMemo(() => new Map((context?.categories ?? []).map((c) => [c.id, c.type])), [context]);
  const history = useMemo(() => historyMap(context?.categoryHistory ?? []), [context]);

  const kindOf = (r: ReadRow): RowKind => rowKind[r.row] ?? (r.transferGroupId !== null ? "Transfer" : r.type);
  const typeOf = (r: ReadRow): ImportType => {
    const k = kindOf(r);
    return k === "Transfer" ? r.type : k;
  };

  // The other side of a transfer, matched on the device against the
  // person's own entries on their other accounts.
  const transferMatches = useMemo(
    () =>
      context
        ? findTransferMatches(
            included.map((r) => ({
              row: r.row,
              type: typeOf(r),
              date: r.date,
              cents: r.cents,
              otherAccountId: rowOther[r.row] ?? exportPartner.get(r.row) ?? null,
            })),
            context.transferCandidates.filter((c) => otherById.has(c.accountId)),
          )
        : new Map<number, TransferMatch>(),
    // typeOf reads rowKind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [context, included, rowKind, rowOther, exportPartner, otherById],
  );

  // File category names matched to the person's (one exact match, by type).
  const fileCategories = useMemo(() => {
    if (!context) return null;
    const plain = included.filter((r) => kindOf(r) !== "Transfer").map((r) => ({ row: r.row, type: typeOf(r), categoryName: r.categoryName }));
    return matchCategories(plain, context.categories);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, included, rowKind]);

  const categories = useMemo(() => {
    if (!context || !fileCategories) return null;
    return resolveRowCategories(
      included.map((r) => ({
        row: r.row,
        type: typeOf(r),
        transfer: kindOf(r) === "Transfer",
        description: r.description,
        fileCategoryId: fileCategories.byRow.get(r.row) ?? null,
      })),
      categoryTypes,
      new Map(Object.entries(rowCategory).map(([k, v]) => [Number(k), v])),
      history,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, fileCategories, included, rowKind, rowCategory, categoryTypes, history]);

  const views: RowView[] = useMemo(() => {
    const inc = new Set(included.map((r) => r.row));
    return scoped.map((r) => {
      const kind = kindOf(r);
      const type = typeOf(r);
      const anyMatch = transferMatches.get(r.row);
      const otherAccountId =
        kind === "Transfer" ? (rowOther[r.row] ?? exportPartner.get(r.row) ?? anyMatch?.candidate.accountId ?? null) : null;
      const match = kind === "Transfer" && anyMatch && anyMatch.candidate.accountId === otherAccountId ? anyMatch : undefined;
      const joinable = match?.candidate.pairable === true;
      return {
        r,
        included: inc.has(r.row),
        kind,
        type,
        category: categories?.byRow.get(r.row),
        otherAccountId,
        match,
        pairWith: joinable && pairAnswer[r.row] === "pair" ? match!.candidate.id : null,
        pairUnanswered: joinable && pairAnswer[r.row] === undefined,
        looksLikeTransfer: kind !== "Transfer" && (transferWording(r.description) || anyMatch !== undefined),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, included, rowKind, rowOther, exportPartner, transferMatches, categories, pairAnswer]);
  const includedViews = useMemo(() => views.filter((v) => v.included), [views]);
  const viewByRow = useMemo(() => new Map(views.map((v) => [v.r.row, v])), [views]);

  const transferPayload = (v: RowView) =>
    v.kind === "Transfer" && v.otherAccountId !== null ? { otherAccountId: v.otherAccountId, pairWith: v.pairWith } : null;

  // This account's figures: every included row has a leg here.
  const summary = useMemo(
    () =>
      summarizeImport(
        includedViews.map((v) => ({ date: v.r.date, cents: v.r.cents, type: v.type, transfer: v.kind === "Transfer" })),
        treatments,
        preAnchor,
      ),
    [includedViews, treatments, preAnchor],
  );

  // Each other account a CREATED leg lands on: its own balance change and
  // its own pre-anchor question. A joined row adds nothing there -- the
  // entry is already in that balance.
  const otherSummaries = useMemo(() => {
    const byAccount = new Map<string, RowView[]>();
    for (const v of includedViews) {
      if (v.kind !== "Transfer" || v.otherAccountId === null || v.pairWith !== null) continue;
      const list = byAccount.get(v.otherAccountId) ?? [];
      list.push(v);
      byAccount.set(v.otherAccountId, list);
    }
    const out: { account: OtherAccount; summary: ImportSummary; legs: number }[] = [];
    for (const [id, legs] of byAccount) {
      const acct = otherById.get(id);
      if (!acct) continue;
      const t = new Map<string, DateTreatment>(acct.treatments.map((x) => [x.date, x]));
      out.push({
        account: acct,
        legs: legs.length,
        summary: summarizeImport(
          legs.map((v) => ({ date: v.r.date, cents: v.r.cents, type: flip(v.type), transfer: true })),
          t,
          preAnchorOther[id] ?? null,
        ),
      });
    }
    return out.sort((a, b) => a.account.name.localeCompare(b.account.name));
  }, [includedViews, otherById, preAnchorOther]);
  const joinedCount = includedViews.filter((v) => v.pairWith !== null).length;

  const matches = useMemo(
    () =>
      context
        ? findImportSameBill(
            sameBillRows(
              includedViews
                .filter((v) => v.kind !== "Transfer" || v.otherAccountId !== null)
                .map((v) => ({ row: v.r.row, type: v.type, date: v.r.date, cents: v.r.cents, transfer: transferPayload(v) })),
            ),
            context.queue,
            accountId,
          )
        : [],
    [context, includedViews, accountId],
  );
  const matchByRow = useMemo(() => new Map(matches.map((m) => [m.row, m])), [matches]);

  const unanswered = matches.filter((m) => sameBill[m.row] === undefined).length;
  const missingCategories = categories?.missing.length ?? 0;
  const transfersWithoutAccount = includedViews.filter((v) => v.kind === "Transfer" && v.otherAccountId === null).length;
  const unansweredPairs = includedViews.filter((v) => v.pairUnanswered).length;
  const otherAnswerNeeded = otherSummaries.some((o) => o.summary.answerNeeded);
  const otherUndescribed = otherSummaries.some((o) => o.summary.undescribed > 0);
  const ready =
    context !== null &&
    included.length > 0 &&
    !summary.answerNeeded &&
    summary.undescribed === 0 &&
    !otherAnswerNeeded &&
    !otherUndescribed &&
    missingCategories === 0 &&
    transfersWithoutAccount === 0 &&
    unansweredPairs === 0 &&
    unanswered === 0 &&
    !saving;

  // Rows first the duplicates, then the file's own order.
  const tableRows = useMemo(
    () => [...views].sort((a, b) => Number(dupes.has(b.r.row)) - Number(dupes.has(a.r.row)) || a.r.row - b.r.row),
    [views, dupes],
  );

  // ---- answers that touch several rows -------------------------------

  function setKind(row: number, kind: RowKind) {
    setRowKind((s) => ({ ...s, [row]: kind }));
    // A category is for one type: changing the type clears the row's choice.
    setRowCategory((s) => {
      const next = { ...s };
      delete next[row];
      return next;
    });
    setPairAnswer((s) => {
      const next = { ...s };
      delete next[row];
      return next;
    });
    setLastPick((p) => (p?.row === row ? null : p));
  }

  function pickCategory(row: number, categoryId: string) {
    setRowCategory((s) => ({ ...s, [row]: categoryId }));
    setLastPick(categoryId === "" ? null : { row, categoryId });
  }

  function setRows(rows: readonly number[], categoryId: string) {
    setRowCategory((s) => {
      const next = { ...s };
      for (const row of rows) next[row] = categoryId;
      return next;
    });
  }

  const shortcut = useMemo(() => {
    if (!lastPick || !categories) return null;
    const v = viewByRow.get(lastPick.row);
    if (!v || !v.included || v.kind === "Transfer") return null;
    const found = sameMerchantRows(
      { row: v.r.row, type: v.type, description: v.r.description, categoryId: lastPick.categoryId },
      includedViews.map((x) => ({ row: x.r.row, type: x.type, transfer: x.kind === "Transfer", description: x.r.description })),
      categories.byRow,
    );
    return found ? { ...found, row: lastPick.row, categoryId: lastPick.categoryId } : null;
  }, [lastPick, categories, viewByRow, includedViews]);

  function save() {
    if (!context || !categories) return;
    setSaveError(undefined);
    const otherAnswer = new Map(
      otherSummaries.map((o) => [
        o.account.id,
        o.summary.beforeAnchorCount > 0 ? choiceToCountsDespiteAnchor(preAnchorOther[o.account.id] ?? null) : null,
      ]),
    );
    startSave(async () => {
      const res = await importTransactionsAction({
        accountId,
        countsDespiteAnchor: summary.beforeAnchorCount > 0 ? choiceToCountsDespiteAnchor(preAnchor) : null,
        idempotencyKey: attemptKey,
        rows: includedViews.map((v) => {
          const r = v.r;
          const m = matchByRow.get(r.row);
          const answer = sameBill[r.row];
          const transfer = transferPayload(v);
          return {
            row: r.row,
            date: r.date,
            cents: r.cents,
            type: v.type,
            description: r.description,
            notes: r.notes,
            merchant: r.merchant,
            paymentMethod: r.paymentMethod,
            categoryId: transfer === null ? (v.category?.id ?? "") : null,
            transfer:
              transfer === null
                ? null
                : {
                    ...transfer,
                    countsDespiteAnchor: transfer.pairWith === null ? (otherAnswer.get(transfer.otherAccountId) ?? null) : null,
                  },
            isEstimated: r.isEstimated,
            includeDuplicate: dupes.has(r.row) && includeDup[r.row] === true,
            sameBill: m && answer ? { answer, recurringId: m.recurringId, dueDate: m.dueDate } : null,
          };
        }),
      });
      if (res.error !== undefined) {
        setSaveError(res.error);
        return;
      }
      // Drop the file's rows from memory: it has done its job.
      setRecords(null);
      setCols(null);
      setDone({ importId: res.data.importId, rowCount: res.data.rowCount, accountName: account?.name ?? "", accountId });
      showCompletion(res.data.completion);
    });
  }

  // ---- render --------------------------------------------------------

  if (done) {
    return (
      <section aria-labelledby="done-heading" className={CARD}>
        <h2 id="done-heading" className={H2}>
          {done.rowCount.toLocaleString("en-US")} {done.rowCount === 1 ? "transaction" : "transactions"} imported into {done.accountName}
        </h2>
        <p className={SUB}>They&apos;re in your list and your balances now. If this wasn&apos;t the file you meant, undo it and nothing stays.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link href={`/accounts/${done.accountId}`} className={buttonClass("primary")}>
            See {done.accountName}
          </Link>
          <UndoImportButton importId={done.importId} label="Undo this import" onUndone={() => setDone(null)} />
        </div>
      </section>
    );
  }

  const otherAccountOptions = context?.otherAccounts ?? [];
  const groups = fileCategories?.unmatched ?? [];

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="file-heading" className={CARD}>
        <h2 id="file-heading" className={H2}>
          Choose a file
        </h2>
        <p className={SUB}>
          A CSV file from your bank, read on this device. Descriptions and amounts stay on your device until you confirm;
          before that, Sorrel only checks the file&apos;s dates against your balance dates.
        </p>

        <div className="mt-4 flex max-w-md flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="import-account" className="text-sm font-medium text-ink-secondary">
              Into which account
            </label>
            <select id="import-account" value={accountId} onChange={(e) => onAccount(e.target.value)} className={FIELD_CLASS}>
              <option value="">Choose an account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-ink-muted">One account per import. A bank file describes one account.</p>
            {account && importedThroughSentence(account.name, importedThrough[account.id] ?? null, today) ? (
              <p className="text-xs text-ink-muted">{importedThroughSentence(account.name, importedThrough[account.id] ?? null, today)}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="import-file" className="text-sm font-medium text-ink-secondary">
              CSV file
            </label>
            <input
              id="import-file"
              type="file"
              accept=".csv,text/csv,.txt"
              disabled={accountId === ""}
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                // So choosing the same file again re-reads it.
                e.target.value = "";
              }}
              className={`${FIELD_CLASS} file:mr-3 file:rounded-full file:border-0 file:bg-action file:px-3 file:py-1 file:text-sm file:font-semibold file:text-action-ink`}
            />
            {accountId === "" ? <p className="text-xs text-ink-muted">Choose the account first.</p> : null}
            <p className="text-xs text-ink-muted">
              No need to wait for a statement. Most banks let you download recent activity any time. Look for
              &quot;Download&quot; or &quot;Export&quot; on the account&apos;s activity page. Overlapping dates are
              fine: Sorrel skips what it already has.
            </p>
          </div>
        </div>

        {fileError ? (
          <div className="mt-4">
            <ErrorMessage severity="critical" message={fileError} />
          </div>
        ) : null}
      </section>

      {records && own ? (
        <section aria-labelledby="export-heading" className={CARD}>
          <h2 id="export-heading" className={H2}>
            This is a Sorrel export
          </h2>
          <p className={SUB}>
            It carries its own columns, so there&apos;s nothing to map. Say which of the accounts in the file is{" "}
            {account?.name ?? "this account"}.
          </p>
          <div className="mt-3 flex max-w-md flex-col gap-1.5">
            <label htmlFor="export-account" className="text-sm font-medium text-ink-secondary">
              In the file, {account?.name ?? "this account"} is
            </label>
            <select
              id="export-account"
              value={exportKey ?? ""}
              onChange={(e) => setExportKey(e.target.value === "" ? null : e.target.value)}
              className={FIELD_CLASS}
            >
              <option value="">Choose one…</option>
              {exportAccounts.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name} ({a.count} {a.count === 1 ? "transaction" : "transactions"})
                </option>
              ))}
            </select>
          </div>
        </section>
      ) : null}

      {records && !own && cols ? (
        <section aria-labelledby="columns-heading" className={CARD}>
          <h2 id="columns-heading" className={H2}>
            Which column is which
          </h2>
          <p className={SUB}>We made a guess from the headings. Check it against the first rows, and change anything that&apos;s off.</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <ColumnSelect id="col-date" label="Date" header={header} value={cols.date} onChange={(v) => setCols({ ...cols, date: v })} required />
            <ColumnSelect id="col-desc" label="Description" header={header} value={cols.description} onChange={(v) => setCols({ ...cols, description: v })} required />
          </div>

          <fieldset className="mt-4 flex flex-col gap-2">
            <legend className="text-sm font-medium text-ink-secondary">How the amount is laid out</legend>
            <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-2">
              <label className={CHOICE}>
                <input type="radio" name="shape" className="accent-action" checked={cols.shape === "signed"} onChange={() => setCols({ ...cols, shape: "signed" })} />
                One amount column
              </label>
              <label className={CHOICE}>
                <input type="radio" name="shape" className="accent-action" checked={cols.shape === "split"} onChange={() => setCols({ ...cols, shape: "split" })} />
                Separate Debit and Credit columns
              </label>
            </div>
          </fieldset>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {cols.shape === "signed" ? (
              <ColumnSelect id="col-amount" label="Amount" header={header} value={cols.amount} onChange={(v) => setCols({ ...cols, amount: v })} required />
            ) : (
              <>
                <ColumnSelect id="col-debit" label="Debit (money out)" header={header} value={cols.debit} onChange={(v) => setCols({ ...cols, debit: v })} required />
                <ColumnSelect id="col-credit" label="Credit (money in)" header={header} value={cols.credit} onChange={(v) => setCols({ ...cols, credit: v })} required />
              </>
            )}
            <ColumnSelect id="col-cat" label="Category (optional)" header={header} value={cols.category} onChange={(v) => setCols({ ...cols, category: v })} />
            <ColumnSelect id="col-notes" label="Notes (optional)" header={header} value={cols.notes} onChange={(v) => setCols({ ...cols, notes: v })} />
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="pb-1 text-left text-xs text-ink-muted">The first five rows, as the file has them</caption>
              <thead>
                <tr className="border-b border-hairline text-xs text-ink-muted">
                  {header.map((h, i) => (
                    <th key={i} className="px-2 py-1 font-medium">
                      {h || `Column ${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.slice(1, 6).map((r, i) => (
                  <tr key={i} className="border-b border-hairline/50 text-ink-secondary">
                    {header.map((_, c) => (
                      <td key={c} className="max-w-48 truncate px-2 py-1">
                        {r[c] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {records && !own && cols && (needMoneyOut || moneyOut !== null) && signed ? (
        <section aria-labelledby="sign-heading" className={CARD}>
          <h2 id="sign-heading" className={H2}>
            In this file, is money you spent a negative or a positive number?
          </h2>
          {example ? (
            <p className={SUB}>
              Example from your file: <span className="text-ink">{example.description} · {example.rawAmount}</span>
            </p>
          ) : null}
          <p className="mt-1 max-w-prose text-xs text-ink-muted">
            Banks disagree. A checking export usually shows spending as negative; a credit card export often shows
            charges as positive. The preview below shows the result before anything is saved.
          </p>
          <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:gap-2">
            <label className={CHOICE}>
              <input type="radio" name="money-out" className="accent-action" checked={moneyOut === "negative"} onChange={() => setMoneyOut("negative")} />
              Negative
            </label>
            <label className={CHOICE}>
              <input type="radio" name="money-out" className="accent-action" checked={moneyOut === "positive"} onChange={() => setMoneyOut("positive")} />
              Positive
            </label>
          </div>
        </section>
      ) : null}

      {dateFinding?.kind === "ambiguous" ? (
        <section aria-labelledby="date-heading" className={CARD}>
          <h2 id="date-heading" className={H2}>
            Does {dateFinding.example} mean {readableDate(dateFinding.example, "dmy")} or {readableDate(dateFinding.example, "mdy")}?
          </h2>
          <p className={SUB}>Every date in this file could be read either way, so we won&apos;t guess.</p>
          <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:gap-2">
            <label className={CHOICE}>
              <input type="radio" name="date-order" className="accent-action" checked={orderChoice === "dmy"} onChange={() => setOrderChoice("dmy")} />
              {readableDate(dateFinding.example, "dmy")} (day first)
            </label>
            <label className={CHOICE}>
              <input type="radio" name="date-order" className="accent-action" checked={orderChoice === "mdy"} onChange={() => setOrderChoice("mdy")} />
              {readableDate(dateFinding.example, "mdy")} (month first)
            </label>
          </div>
        </section>
      ) : null}
      {mixedDates ? (
        <ErrorMessage
          severity="critical"
          message="The dates in this file use more than one format (some day first, some month first), so we can't read them safely. Save the file with one date format and choose it again."
        />
      ) : null}
      {dateFinding?.kind === "decided" ? (
        <p className="text-sm text-ink-secondary">
          Dates read as {dateFinding.order === "dmy" ? "day/month/year" : "month/day/year"}, because of the dates in the file.
        </p>
      ) : null}

      {read ? (
        <section aria-labelledby="preview-heading" className={CARD}>
          <h2 id="preview-heading" className={H2}>
            Preview
          </h2>
          <p className={SUB}>Nothing is saved until you press Import.</p>

          {notForThisAccount > 0 ? (
            <p className="mt-1 text-sm text-ink-secondary">{notForThisAccount} not for this account.</p>
          ) : null}
          {read.zeroSkipped > 0 ? (
            <p className="mt-1 text-sm text-ink-secondary">
              {read.zeroSkipped} {read.zeroSkipped === 1 ? "row has" : "rows have"} no amount and {read.zeroSkipped === 1 ? "was" : "were"} skipped.
            </p>
          ) : null}

          {own && exportKey === null ? (
            <p className="mt-3 text-sm text-ink-secondary">Choose which account in the file this is, above.</p>
          ) : scoped.length === 0 ? (
            <p className="mt-3 text-sm text-ink-secondary">There are no transactions here to import.</p>
          ) : contextError ? (
            <div className="mt-3">
              <ErrorMessage severity="critical" message={contextError} />
            </div>
          ) : loadingContext ? (
            <p className="mt-3 text-sm text-ink-secondary" role="status">
              Checking against your balance…
            </p>
          ) : context ? (
            <Review
              context={context}
              accountName={account?.name ?? ""}
              accountType={account?.type ?? ""}
              summary={summary}
              otherSummaries={otherSummaries}
              joinedCount={joinedCount}
              dupesCount={dupes.size}
              includedCount={included.length}
              preAnchor={preAnchor}
              onPreAnchor={setPreAnchor}
              preAnchorOther={preAnchorOther}
              onPreAnchorOther={(id, c) => setPreAnchorOther((s) => ({ ...s, [id]: c }))}
              groups={groups}
              groupValue={(rows) => {
                const first = rowCategory[rows[0]];
                return first !== undefined && rows.every((row) => rowCategory[row] === first) ? first : "";
              }}
              onGroup={setRows}
              matches={matches}
              viewByRow={viewByRow}
              sameBill={sameBill}
              onSameBill={(row, a) => setSameBill((s) => ({ ...s, [row]: a }))}
            />
          ) : null}

          {read.unreadable.length > 0 ? (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-ink">
                {read.unreadable.length} {read.unreadable.length === 1 ? "row couldn't" : "rows couldn't"} be read
              </h3>
              <p className="mt-1 text-xs text-ink-muted">
                They&apos;re not imported, and none is guessed at. Fix them in the file and import it again, or add them by hand.
                Row numbers are as a spreadsheet shows them (the header is row 1).
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-secondary">
                {(showAllUnreadable ? read.unreadable : read.unreadable.slice(0, SHOW_UNREADABLE)).map((u) => (
                  <li key={u.row}>
                    Row {u.row}: {u.reason}
                    {u.rawDate || u.rawAmount ? ` (${[u.rawDate, u.rawAmount].filter(Boolean).join(" · ")})` : ""}
                  </li>
                ))}
              </ul>
              {read.unreadable.length > SHOW_UNREADABLE && !showAllUnreadable ? (
                <button type="button" onClick={() => setShowAllUnreadable(true)} className="mt-2 min-h-11 rounded text-sm font-medium text-action hover:text-action-hover hover:underline">
                  Show all {read.unreadable.length}
                </button>
              ) : null}
            </div>
          ) : null}

          {context && scoped.length > 0 ? (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-ink">
                Every transaction in the file for this account{dupes.size > 0 ? ", possible duplicates first" : ""}
              </h3>
              <ul className="mt-2 flex flex-col gap-2">
                {(showAll ? tableRows : tableRows.slice(0, SHOW_ROWS)).map((v) => (
                  <RowItem
                    key={v.r.row}
                    v={v}
                    dup={dupes.get(v.r.row)}
                    includeDup={includeDup[v.r.row] === true}
                    onIncludeDup={(on) => setIncludeDup((s) => ({ ...s, [v.r.row]: on }))}
                    treatment={treatments.get(v.r.date)}
                    categories={context.categories}
                    otherAccounts={otherAccountOptions}
                    otherName={(id) => otherById.get(id)?.name ?? ""}
                    onKind={(k) => setKind(v.r.row, k)}
                    onCategory={(id) => pickCategory(v.r.row, id)}
                    onOther={(id) => {
                      setRowOther((s) => ({ ...s, [v.r.row]: id }));
                      setPairAnswer((s) => {
                        const next = { ...s };
                        delete next[v.r.row];
                        return next;
                      });
                    }}
                    pairAnswer={pairAnswer[v.r.row]}
                    onPair={(a) => setPairAnswer((s) => ({ ...s, [v.r.row]: a }))}
                    shortcut={shortcut && shortcut.row === v.r.row ? shortcut : null}
                    categoryName={(id) => context.categories.find((c) => c.id === id)?.name ?? ""}
                    onApplyShortcut={() => {
                      if (!shortcut) return;
                      setRows(shortcut.rows, shortcut.categoryId);
                      setLastPick(null);
                    }}
                  />
                ))}
              </ul>
              {tableRows.length > SHOW_ROWS && !showAll ? (
                <button type="button" onClick={() => setShowAll(true)} className="mt-2 min-h-11 rounded text-sm font-medium text-action hover:text-action-hover hover:underline">
                  Show all {tableRows.length.toLocaleString("en-US")}
                </button>
              ) : null}
            </div>
          ) : null}

          {context && scoped.length > 0 ? (
            <div className="mt-5 flex flex-col gap-3">
              {saveError ? <ErrorMessage severity="critical" message={saveError} /> : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" disabled={!ready} onClick={save}>
                  {saving ? "Importing…" : `Import ${included.length.toLocaleString("en-US")} ${included.length === 1 ? "transaction" : "transactions"}`}
                </Button>
                {!ready && !saving ? (
                  <p className="text-sm text-ink-secondary">
                    {whatsMissing({
                      answerNeeded: summary.answerNeeded || otherAnswerNeeded,
                      missingCategories,
                      transfersWithoutAccount,
                      unansweredPairs,
                      unanswered,
                      includedCount: included.length,
                    })}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function whatsMissing(m: {
  answerNeeded: boolean;
  missingCategories: number;
  transfersWithoutAccount: number;
  unansweredPairs: number;
  unanswered: number;
  includedCount: number;
}): string {
  if (m.includedCount === 0) return "There's nothing selected to import.";
  const todo: string[] = [];
  if (m.answerNeeded) todo.push("say whether each balance already included the earlier rows");
  if (m.missingCategories > 0) todo.push(`choose a category for ${m.missingCategories} ${m.missingCategories === 1 ? "row" : "rows"}`);
  if (m.transfersWithoutAccount > 0) todo.push(`choose the other account for ${m.transfersWithoutAccount} ${m.transfersWithoutAccount === 1 ? "transfer" : "transfers"}`);
  if (m.unansweredPairs > 0) todo.push("say whether each matching entry is the same transfer");
  if (m.unanswered > 0) todo.push("answer whether each matched bill is the same one");
  return todo.length > 0 ? `To import: ${todo.join(", ")}.` : "";
}

/** "3 April 2026" for 03/04/2026 read day-first; "March 4, 2026" month-first. */
function readableDate(raw: string, order: DateOrder): string {
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(raw.trim());
  if (!m) return raw;
  const day = Number(order === "dmy" ? m[1] : m[2]);
  const month = Number(order === "dmy" ? m[2] : m[1]);
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return order === "dmy" ? `${day} ${names[month - 1]} ${m[3]}` : `${names[month - 1]} ${day}, ${m[3]}`;
}

function ColumnSelect({
  id,
  label,
  header,
  value,
  onChange,
  required = false,
}: {
  id: string;
  label: string;
  header: readonly string[];
  value: number | null;
  onChange: (v: number | null) => void;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-secondary">
        {label}
      </label>
      <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} className={FIELD_CLASS} required={required}>
        <option value="">{required ? "Choose a column…" : "None"}</option>
        {header.map((h, i) => (
          <option key={i} value={i}>
            {h || `Column ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * One file row: a card on a phone, a two-line row on a wider screen. Line
 * one is the file's (date, description, amount); line two is the person's
 * (type, then a category or the transfer's other account).
 */
/**
 * A row's description. Never cut off with no way to read it: on a phone it
 * takes its own full-width line and wraps to two lines; anything longer is
 * clamped there and a tap shows all of it (and a second tap folds it back).
 * The toggle exists only when the text is actually clamped, so a short
 * description is plain text, not a button that does nothing.
 */
function RowDescription({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // Measured while clamped: the full text is taller than two lines.
      if (!open) setClamped(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // `clamped` swaps the plain span for the button, so the element measured changes.
  }, [open, text, clamped]);

  const shared = "order-last basis-full break-words text-left text-ink sm:order-none sm:basis-0 sm:min-w-0 sm:flex-1";
  const clampClass = open ? "" : "line-clamp-2";

  if (!clamped && !open) {
    return (
      <span ref={ref} className={`${shared} ${clampClass}`}>
        {text}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      className={`${shared} rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action`}
    >
      {/* No `block` here: line-clamp sets its own display (-webkit-box), and a
          display class would override it and unclamp the text. */}
      <span ref={ref} className={open ? "block" : clampClass}>
        {text}
      </span>
      <span className="text-xs text-ink-muted">{open ? "Show less" : "Show all"}</span>
    </button>
  );
}

function RowItem({
  v,
  dup,
  includeDup,
  onIncludeDup,
  treatment,
  categories,
  otherAccounts,
  otherName,
  onKind,
  onCategory,
  onOther,
  pairAnswer,
  onPair,
  shortcut,
  categoryName,
  onApplyShortcut,
}: {
  v: RowView;
  dup: { existing: { description: string; date: string } } | undefined;
  includeDup: boolean;
  onIncludeDup: (on: boolean) => void;
  treatment: DateTreatment | undefined;
  categories: ImportContext["categories"];
  otherAccounts: OtherAccount[];
  otherName: (id: string) => string;
  onKind: (k: RowKind) => void;
  onCategory: (id: string) => void;
  onOther: (id: string) => void;
  pairAnswer: "pair" | "new" | undefined;
  onPair: (a: "pair" | "new") => void;
  shortcut: { merchant: string; rows: number[]; categoryId: string } | null;
  categoryName: (id: string) => string;
  onApplyShortcut: () => void;
}) {
  const { r } = v;
  const id = (what: string) => `row-${r.row}-${what}`;
  const options = categories.filter((c) => c.type === v.type).sort((a, b) => a.name.localeCompare(b.name));
  const muted = dup && !includeDup;
  const otherNameShown = v.otherAccountId ? otherName(v.otherAccountId) : "";
  const cand = v.match?.candidate;

  return (
    <li
      className={`flex flex-col gap-2 rounded-lg border border-hairline px-3 py-3 text-sm ${muted ? "text-ink-muted" : "text-ink-secondary"}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xs text-ink-muted">Row {r.row}</span>
        <span>{formatDate(r.date)}</span>
        <RowDescription text={r.description} />
        <Amount amount={dollars(r.cents)} type={v.type} className="ml-auto sm:ml-0" />
      </div>

      {dup ? (
        <label className="flex min-h-11 cursor-pointer items-center gap-2">
          <input type="checkbox" className="accent-action" checked={includeDup} onChange={(e) => onIncludeDup(e.target.checked)} />
          <span>
            Include. Looks like {dup.existing.description}, {formatDayMonth(dup.existing.date)}
          </span>
        </label>
      ) : null}

      {v.included ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <label htmlFor={id("type")} className="sr-only">
            Type for row {r.row}
          </label>
          <select id={id("type")} value={v.kind} onChange={(e) => onKind(e.target.value as RowKind)} className={SMALL_FIELD}>
            <option value="Expense">Spending</option>
            <option value="Income">Income</option>
            <option value="Transfer">{v.type === "Expense" ? "Transfer out" : "Transfer in"}</option>
          </select>

          {v.kind === "Transfer" ? (
            <>
              <label htmlFor={id("other")} className="sr-only">
                {v.type === "Expense" ? "Transfer to" : "Transfer from"} (row {r.row})
              </label>
              <span className="text-ink-secondary sm:hidden">{v.type === "Expense" ? "To" : "From"}</span>
              <select id={id("other")} value={v.otherAccountId ?? ""} onChange={(e) => onOther(e.target.value)} className={SMALL_FIELD}>
                <option value="">{v.type === "Expense" ? "Transfer to…" : "Transfer from…"}</option>
                {otherAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {v.type === "Expense" ? "To" : "From"} {a.name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <label htmlFor={id("cat")} className="sr-only">
                Category for row {r.row}
              </label>
              <select
                id={id("cat")}
                value={v.category?.id ?? ""}
                onChange={(e) => onCategory(e.target.value)}
                className={SMALL_FIELD}
                aria-describedby={v.category?.source === "suggested" ? id("suggested") : undefined}
              >
                <option value="">Choose a category…</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {v.category?.source === "suggested" ? (
                <span id={id("suggested")} className="text-xs text-ink-muted">
                  Suggested from your past entries
                </span>
              ) : null}
            </>
          )}

          {v.looksLikeTransfer ? (
            <span className="flex items-center gap-1 text-xs text-ink-secondary">
              <InfoIcon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
              Looks like a transfer
            </span>
          ) : null}
          {treatment?.treatment === "before_anchor" ? (
            <span className="text-xs text-ink-muted">Before your balance date</span>
          ) : treatment?.treatment === "future" ? (
            <span className="text-xs text-ink-muted">Dated ahead</span>
          ) : null}
        </div>
      ) : null}

      {v.included && shortcut ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-raised px-3 py-2">
          <span className="text-ink-secondary">
            Apply {categoryName(shortcut.categoryId)} to {shortcut.rows.length} other {shortcut.merchant}{" "}
            {shortcut.rows.length === 1 ? "row" : "rows"}?
          </span>
          <Button type="button" variant="secondary" onClick={onApplyShortcut}>
            Apply to {shortcut.rows.length}
          </Button>
        </div>
      ) : null}

      {v.included && v.kind === "Transfer" && cand ? (
        cand.pairable ? (
          <fieldset className="flex flex-col gap-2 rounded-lg bg-surface-raised px-3 py-3">
            <legend className="sr-only">Is row {r.row} the same transfer as the entry on {otherNameShown}?</legend>
            <p className="text-ink-secondary">
              This matches <Amount amount={dollars(cand.cents)} type={cand.type} /> already on {otherNameShown} ({cand.description},{" "}
              {formatDayMonth(cand.date)}). Make them one transfer?
            </p>
            <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-2">
              <label className={CHOICE}>
                <input type="radio" name={id("pair")} className="accent-action" checked={pairAnswer === "pair"} onChange={() => onPair("pair")} />
                Yes, make them one transfer
              </label>
              <label className={CHOICE}>
                <input type="radio" name={id("pair")} className="accent-action" checked={pairAnswer === "new"} onChange={() => onPair("new")} />
                No, add a new entry on {otherNameShown}
              </label>
            </div>
          </fieldset>
        ) : (
          <p className="flex items-start gap-2 text-xs text-ink-secondary">
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <span>
              {otherNameShown} already has {formatCurrency(dollars(cand.cents))} on {formatDayMonth(cand.date)} ({cand.description}),
              but it belongs to a schedule or a goal, so it can&apos;t be joined to this. As a transfer, this adds a second
              entry on {otherNameShown}.
            </span>
          </p>
        )
      ) : null}
    </li>
  );
}

function BalanceLine({
  name,
  type,
  beforeCents,
  summary,
}: {
  name: string;
  type: string;
  beforeCents: number;
  summary: ImportSummary;
}) {
  const afterCents = beforeCents + summary.balanceChangeCents;
  return (
    <p className="text-sm text-ink">
      {name} goes from {formatAccountBalance(dollars(beforeCents), type)} to{" "}
      <span className="font-semibold">{formatAccountBalance(dollars(afterCents), type)}</span>
      {summary.answerNeeded ? " once you answer below" : ""}
    </p>
  );
}

function PreAnchorFieldset({
  name,
  count,
  intro,
  balance,
  openingDate,
  value,
  onChange,
}: {
  name: string;
  count: number;
  intro: string;
  balance: string;
  openingDate: string;
  value: PreAnchorChoice;
  onChange: (c: PreAnchorChoice) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface-raised px-3 py-3 text-sm">
      <legend className="sr-only">Were the earlier rows already in that balance?</legend>
      <p className="flex items-start gap-2 text-ink-secondary">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
        <span>
          <span className="text-ink">
            {intro} dated before your balance of {balance} on {formatDate(openingDate)}.
          </span>{" "}
          Was that balance already including {count === 1 ? "it" : "them"}?
        </span>
      </p>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-2">
        <label className={CHOICE}>
          <input type="radio" name={name} className="accent-action" checked={value === "included"} onChange={() => onChange("included")} />
          Yes, {count === 1 ? "it's" : "they're"} already counted
        </label>
        <label className={CHOICE}>
          <input type="radio" name={name} className="accent-action" checked={value === "added"} onChange={() => onChange("added")} />
          No, add {count === 1 ? "it" : "them"} to my balance
        </label>
      </div>
    </fieldset>
  );
}

function Review({
  context,
  accountName,
  accountType,
  summary,
  otherSummaries,
  joinedCount,
  dupesCount,
  includedCount,
  preAnchor,
  onPreAnchor,
  preAnchorOther,
  onPreAnchorOther,
  groups,
  groupValue,
  onGroup,
  matches,
  viewByRow,
  sameBill,
  onSameBill,
}: {
  context: ImportContext;
  accountName: string;
  accountType: string;
  summary: ImportSummary;
  otherSummaries: { account: OtherAccount; summary: ImportSummary; legs: number }[];
  joinedCount: number;
  dupesCount: number;
  includedCount: number;
  preAnchor: PreAnchorChoice;
  onPreAnchor: (c: PreAnchorChoice) => void;
  preAnchorOther: Record<string, PreAnchorChoice>;
  onPreAnchorOther: (accountId: string, c: PreAnchorChoice) => void;
  groups: ReturnType<typeof matchCategories>["unmatched"];
  groupValue: (rows: number[]) => string;
  onGroup: (rows: number[], categoryId: string) => void;
  matches: ReturnType<typeof findImportSameBill>;
  viewByRow: ReadonlyMap<number, RowView>;
  sameBill: Record<number, "same" | "different">;
  onSameBill: (row: number, a: "same" | "different") => void;
}) {
  // Integer cents: each balance is read as dollars once, then added to.
  const beforeCents = Math.round(context.account.balance * 100);

  return (
    <div className="mt-3 flex flex-col gap-4">
      <div>
        <p className="text-lg font-semibold text-ink">
          {includedCount.toLocaleString("en-US")} {includedCount === 1 ? "transaction" : "transactions"} into {accountName}
        </p>
        <p className="mt-1 text-sm text-ink-secondary">
          {summary.spentCount} spent · {formatCurrency(dollars(summary.spentCents))}, {summary.receivedCount} received ·{" "}
          {formatCurrency(dollars(summary.receivedCents))}
          {summary.transferCount > 0 ? `, ${summary.transferCount} ${summary.transferCount === 1 ? "transfer" : "transfers"}` : ""}
        </p>
        <div className="mt-2 flex flex-col gap-1">
          <BalanceLine name={accountName} type={accountType} beforeCents={beforeCents} summary={summary} />
          {otherSummaries.map((o) => (
            <BalanceLine
              key={o.account.id}
              name={o.account.name}
              type={o.account.type}
              beforeCents={Math.round(o.account.balance * 100)}
              summary={o.summary}
            />
          ))}
        </div>
        {joinedCount > 0 ? (
          <p className="mt-1 text-xs text-ink-muted">
            {joinedCount} {joinedCount === 1 ? "transfer joins an entry" : "transfers join entries"} already on the other
            account, so that balance doesn&apos;t change.
          </p>
        ) : null}
        {summary.countedCount < includedCount ? (
          <p className="mt-1 text-xs text-ink-muted">
            {includedCount - summary.countedCount} of these {includedCount - summary.countedCount === 1 ? "doesn't" : "don't"} change{" "}
            {accountName}&apos;s balance today
            {summary.futureCount > 0 ? ` (${summary.futureCount} dated ahead count on their dates)` : ""}.
          </p>
        ) : null}
      </div>

      {dupesCount > 0 ? (
        <p className="flex items-start gap-2 text-sm text-ink-secondary">
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
          {dupesCount} look like transactions you already have, so they&apos;re skipped. Tick Include on any you want anyway.
        </p>
      ) : null}

      {summary.beforeAnchorCount > 0 ? (
        <PreAnchorFieldset
          name="pre-anchor"
          count={summary.beforeAnchorCount}
          intro={`${summary.beforeAnchorCount} of these ${summary.beforeAnchorCount === 1 ? "is" : "are"}`}
          balance={formatAccountBalance(context.account.openingBalance, accountType)}
          openingDate={context.account.openingDate}
          value={preAnchor}
          onChange={onPreAnchor}
        />
      ) : null}

      {otherSummaries
        .filter((o) => o.summary.beforeAnchorCount > 0)
        .map((o) => (
          <PreAnchorFieldset
            key={o.account.id}
            name={`pre-anchor-${o.account.id}`}
            count={o.summary.beforeAnchorCount}
            intro={`${o.summary.beforeAnchorCount} ${o.summary.beforeAnchorCount === 1 ? "transfer" : "transfers"} on ${o.account.name} ${o.summary.beforeAnchorCount === 1 ? "is" : "are"}`}
            balance={formatAccountBalance(o.account.openingBalance, o.account.type)}
            openingDate={o.account.openingDate}
            value={preAnchorOther[o.account.id] ?? null}
            onChange={(c) => onPreAnchorOther(o.account.id, c)}
          />
        ))}

      {groups.length > 0 ? (
        <fieldset className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface-raised px-3 py-3 text-sm">
          <legend className="sr-only">Categories</legend>
          <p className="text-ink-secondary">
            Every transaction needs a category. Choose one on each row below, or set a whole group at once here. A
            suggestion from your past entries can be changed. Nothing is created for you.
          </p>
          {groups.map((g) => {
            const id = `cat-${g.key}`;
            const options = context.categories.filter((c) => c.type === g.type).sort((a, b) => a.name.localeCompare(b.name));
            return (
              <div key={g.key} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                <label htmlFor={id} className="text-ink sm:w-80">
                  Set all {g.count} {g.type === "Income" ? "income" : "spending"} {g.count === 1 ? "row" : "rows"}
                  {g.name ? ` filed as ${g.name}` : g.count > 0 ? " with no category in the file" : ""} to
                </label>
                <select id={id} value={groupValue(g.rows)} onChange={(e) => e.target.value && onGroup(g.rows, e.target.value)} className={`${FIELD_CLASS} sm:max-w-xs`}>
                  <option value="">Choose a category…</option>
                  {options.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </fieldset>
      ) : null}

      {matches.length > 0 ? (
        <div className="flex flex-col gap-3">
          {matches.map((m) => {
            const v = viewByRow.get(m.row);
            if (!v) return null;
            const row = v.r;
            return (
              <fieldset key={m.row} className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface-raised px-3 py-3 text-sm">
                <legend className="sr-only">Is row {m.row} the same bill?</legend>
                <p className="flex items-start gap-2">
                  <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                  <span className="text-ink-secondary">
                    <span className="font-medium text-ink">Is this the same bill?</span> {row.description} ·{" "}
                    <Amount amount={dollars(row.cents)} type={v.type} /> · {formatDayMonth(row.date)} looks like {m.name}&apos;s{" "}
                    {formatDayMonth(m.dueDate)} {v.kind === "Transfer" ? "transfer" : "payment"}, which is still waiting in your confirmation list.
                  </span>
                </p>
                <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-2 sm:pl-6">
                  <label className={CHOICE}>
                    <input type="radio" name={`same-${m.row}`} className="accent-action" checked={sameBill[m.row] === "same"} onChange={() => onSameBill(m.row, "same")} />
                    Yes, they&apos;re the same
                  </label>
                  <label className={CHOICE}>
                    <input type="radio" name={`same-${m.row}`} className="accent-action" checked={sameBill[m.row] === "different"} onChange={() => onSameBill(m.row, "different")} />
                    No, keep both
                  </label>
                </div>
              </fieldset>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
