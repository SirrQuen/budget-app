"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { getImportContextAction, importTransactionsAction } from "@/lib/actions/import";
import type { ImportContext } from "@/lib/db/imports";
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
  type PreAnchorChoice,
} from "@/lib/importReview";
import { findImportSameBill } from "@/lib/sameBill";
import { formatAccountBalance, formatCurrency, formatDate, formatDayMonth } from "@/lib/format";
import { Amount } from "@/components/ui/Amount";
import { Button, buttonClass } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { FIELD_CLASS } from "@/components/ui/Input";
import { InfoIcon } from "@/components/ui/icons";
import { UndoImportButton } from "./UndoImportButton";

// Import (docs/Import-CSV.md). The file is read HERE, in the browser, and
// never leaves it: no upload, no filename kept (it isn't even held in
// state), nothing logged. The server hears from this component twice:
//
//   1. getImportContextAction(account, DATES) -- the preview's question.
//      Distinct dates and the account id, no descriptions, no amounts.
//   2. importTransactionsAction(...) -- once, after the person presses
//      Import, with only the rows they confirmed.
//
// Nothing is saved before step 2. The preview shows what step 2 will do to
// the balance, from the database's rule (import_preview -> counts_in_balance);
// this file only applies the person's one answer and adds up integer cents.
//
// Three answers are REQUIRED with no default: which way money goes (a
// one-column amount), the date format (when every date could be read
// either way), and whether rows before the balance date were already in
// that balance. Same for each "same bill" question and each category the
// database needs.

export type ImportAccount = { id: string; name: string; type: string };

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
const SHOW_ROWS = 200;
const SHOW_UNREADABLE = 50;

const dollars = (cents: number) => cents / 100;

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

export function ImportFlow({
  accounts,
  initialAccountId,
  today,
}: {
  accounts: ImportAccount[];
  initialAccountId: string | null;
  today: string;
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
  const [includeDup, setIncludeDup] = useState<Record<number, boolean>>({});
  const [categoryChoice, setCategoryChoice] = useState<Record<string, string>>({});
  const [sameBill, setSameBill] = useState<Record<number, "same" | "different">>({});
  const [showAll, setShowAll] = useState(false);
  const [showAllUnreadable, setShowAllUnreadable] = useState(false);

  const [saving, startSave] = useTransition();
  const [saveError, setSaveError] = useState<string>();
  const [done, setDone] = useState<{ importId: string; rowCount: number; accountName: string; accountId: string } | null>(null);

  const account = accounts.find((a) => a.id === accountId) ?? null;
  const header = records?.[0] ?? [];

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
    setPreAnchor(null);
    setIncludeDup({});
    setCategoryChoice({});
    setSameBill({});
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
    setPreAnchor(null);
    setSameBill({});
    setCategoryChoice({});
    setIncludeDup({});
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
  const summary = useMemo(() => summarizeImport(included, treatments, preAnchor), [included, treatments, preAnchor]);
  const categories = useMemo(
    () => (context ? matchCategories(included, context.categories, new Map(Object.entries(categoryChoice))) : null),
    [context, included, categoryChoice],
  );
  const matches = useMemo(
    () =>
      context
        ? findImportSameBill(
            included.map((r) => ({ row: r.row, type: r.type, date: r.date, cents: r.cents })),
            context.queue,
            accountId,
          )
        : [],
    [context, included, accountId],
  );
  const matchByRow = useMemo(() => new Map(matches.map((m) => [m.row, m])), [matches]);

  const unanswered = matches.filter((m) => sameBill[m.row] === undefined).length;
  const unresolved = categories?.unresolved.length ?? 0;
  const ready =
    context !== null &&
    included.length > 0 &&
    !summary.answerNeeded &&
    summary.undescribed === 0 &&
    unresolved === 0 &&
    unanswered === 0 &&
    !saving;

  // Rows first the duplicates, then the file's own order.
  const tableRows = useMemo(
    () => [...scoped].sort((a, b) => Number(dupes.has(b.row)) - Number(dupes.has(a.row)) || a.row - b.row),
    [scoped, dupes],
  );

  function save() {
    if (!context || !categories) return;
    setSaveError(undefined);
    startSave(async () => {
      const res = await importTransactionsAction({
        accountId,
        countsDespiteAnchor: summary.beforeAnchorCount > 0 ? choiceToCountsDespiteAnchor(preAnchor) : null,
        idempotencyKey: attemptKey,
        rows: included.map((r) => {
          const m = matchByRow.get(r.row);
          const answer = sameBill[r.row];
          return {
            row: r.row,
            date: r.date,
            cents: r.cents,
            type: r.type,
            description: r.description,
            notes: r.notes,
            merchant: r.merchant,
            paymentMethod: r.paymentMethod,
            categoryId: categories.byRow.get(r.row) ?? "",
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
    });
  }

  // ---- render --------------------------------------------------------

  if (done) {
    return (
      <section aria-labelledby="done-heading" className={CARD}>
        <h2 id="done-heading" className={H2}>
          {done.rowCount.toLocaleString("en-US")} {done.rowCount === 1 ? "transaction" : "transactions"} imported into {done.accountName}
        </h2>
        <p className={SUB}>They&apos;re in your list and your balance now. If this wasn&apos;t the file you meant, undo it and nothing stays.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link href={`/accounts/${done.accountId}`} className={buttonClass("primary")}>
            See {done.accountName}
          </Link>
          <UndoImportButton importId={done.importId} label="Undo this import" onUndone={() => setDone(null)} />
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="file-heading" className={CARD}>
        <h2 id="file-heading" className={H2}>
          Choose a file
        </h2>
        <p className={SUB}>
          A CSV file from your bank. It&apos;s read on this device and never uploaded: only the transactions you confirm
          below are sent, after you press Import.
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

          {read.transfersSkipped > 0 ? (
            <p className="mt-3 text-sm text-ink-secondary">
              {read.transfersSkipped} {read.transfersSkipped === 1 ? "transfer" : "transfers"} skipped. Add those by hand.
            </p>
          ) : null}
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
              dupesCount={dupes.size}
              includedCount={included.length}
              preAnchor={preAnchor}
              onPreAnchor={setPreAnchor}
              categories={categories}
              categoryChoice={categoryChoice}
              onCategory={(key, id) => setCategoryChoice((c) => ({ ...c, [key]: id }))}
              matches={matches}
              rowsByNumber={new Map(scoped.map((r) => [r.row, r]))}
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
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="pb-1 text-left text-xs text-ink-muted">
                  Every transaction in the file for this account{dupes.size > 0 ? ", possible duplicates first" : ""}
                </caption>
                <thead>
                  <tr className="border-b border-hairline text-xs text-ink-muted">
                    <th className="px-2 py-1 font-medium">Row</th>
                    <th className="px-2 py-1 font-medium">Date</th>
                    <th className="px-2 py-1 font-medium">Description</th>
                    <th className="px-2 py-1 text-right font-medium">Amount</th>
                    <th className="px-2 py-1 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAll ? tableRows : tableRows.slice(0, SHOW_ROWS)).map((r) => {
                    const dup = dupes.get(r.row);
                    const t = treatments.get(r.date);
                    return (
                      <tr key={r.row} className={`border-b border-hairline/50 ${dup && !includeDup[r.row] ? "text-ink-muted" : "text-ink-secondary"}`}>
                        <td className="px-2 py-1 tabular-nums">{r.row}</td>
                        <td className="px-2 py-1">{formatDate(r.date)}</td>
                        <td className="max-w-64 truncate px-2 py-1 text-ink">{r.description}</td>
                        <td className="px-2 py-1 text-right">
                          <Amount amount={dollars(r.cents)} type={r.type} column />
                        </td>
                        <td className="px-2 py-1">
                          {dup ? (
                            <label className="flex min-h-11 cursor-pointer items-center gap-2">
                              <input
                                type="checkbox"
                                className="accent-action"
                                checked={includeDup[r.row] === true}
                                onChange={(e) => setIncludeDup((s) => ({ ...s, [r.row]: e.target.checked }))}
                              />
                              <span>
                                Include. Looks like {dup.existing.description}, {formatDayMonth(dup.existing.date)}
                              </span>
                            </label>
                          ) : t?.treatment === "before_anchor" ? (
                            "Before your balance date"
                          ) : t?.treatment === "future" ? (
                            "Dated ahead"
                          ) : (
                            ""
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
                {!ready && !saving ? <p className="text-sm text-ink-secondary">{whatsMissing(summary.answerNeeded, unresolved, unanswered, included.length)}</p> : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function whatsMissing(answerNeeded: boolean, unresolved: number, unanswered: number, includedCount: number): string {
  if (includedCount === 0) return "There's nothing selected to import.";
  const todo: string[] = [];
  if (answerNeeded) todo.push("say whether your balance already included the earlier rows");
  if (unresolved > 0) todo.push("choose a category for each group above");
  if (unanswered > 0) todo.push("answer whether each matched bill is the same one");
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

function Review({
  context,
  accountName,
  accountType,
  summary,
  dupesCount,
  includedCount,
  preAnchor,
  onPreAnchor,
  categories,
  categoryChoice,
  onCategory,
  matches,
  rowsByNumber,
  sameBill,
  onSameBill,
}: {
  context: ImportContext;
  accountName: string;
  accountType: string;
  summary: ReturnType<typeof summarizeImport>;
  dupesCount: number;
  includedCount: number;
  preAnchor: PreAnchorChoice;
  onPreAnchor: (c: PreAnchorChoice) => void;
  categories: ReturnType<typeof matchCategories> | null;
  categoryChoice: Record<string, string>;
  onCategory: (key: string, id: string) => void;
  matches: ReturnType<typeof findImportSameBill>;
  rowsByNumber: ReadonlyMap<number, ReadRow>;
  sameBill: Record<number, "same" | "different">;
  onSameBill: (row: number, a: "same" | "different") => void;
}) {
  // Integer cents: the balance is read as dollars once, then added to.
  const beforeCents = Math.round(context.account.balance * 100);
  const afterCents = beforeCents + summary.balanceChangeCents;
  const anchorBalance = formatAccountBalance(context.account.openingBalance, accountType);

  return (
    <div className="mt-3 flex flex-col gap-4">
      <div>
        <p className="text-lg font-semibold text-ink">
          {includedCount.toLocaleString("en-US")} {includedCount === 1 ? "transaction" : "transactions"} into {accountName}
        </p>
        <p className="mt-1 text-sm text-ink-secondary">
          {summary.spentCount} spent · {formatCurrency(dollars(summary.spentCents))}, {summary.receivedCount} received ·{" "}
          {formatCurrency(dollars(summary.receivedCents))}
        </p>
        <p className="mt-2 text-sm text-ink">
          {accountName} goes from {formatAccountBalance(dollars(beforeCents), accountType)} to{" "}
          <span className="font-semibold">{formatAccountBalance(dollars(afterCents), accountType)}</span>
          {summary.answerNeeded ? " once you answer below" : ""}
        </p>
        {summary.countedCount < includedCount ? (
          <p className="mt-1 text-xs text-ink-muted">
            {includedCount - summary.countedCount} of these {includedCount - summary.countedCount === 1 ? "doesn't" : "don't"} change the balance today
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
        <fieldset className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface-raised px-3 py-3 text-sm">
          <legend className="sr-only">Were the earlier rows already in your balance?</legend>
          <p className="flex items-start gap-2 text-ink-secondary">
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <span>
              <span className="text-ink">
                {summary.beforeAnchorCount} of these {summary.beforeAnchorCount === 1 ? "is" : "are"} dated before your balance of{" "}
                {anchorBalance} on {formatDate(context.account.openingDate)}.
              </span>{" "}
              Was that balance already including {summary.beforeAnchorCount === 1 ? "it" : "them"}?
            </span>
          </p>
          <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-2">
            <label className={CHOICE}>
              <input type="radio" name="pre-anchor" className="accent-action" checked={preAnchor === "included"} onChange={() => onPreAnchor("included")} />
              Yes, they&apos;re already counted
            </label>
            <label className={CHOICE}>
              <input type="radio" name="pre-anchor" className="accent-action" checked={preAnchor === "added"} onChange={() => onPreAnchor("added")} />
              No, add them to my balance
            </label>
          </div>
        </fieldset>
      ) : null}

      {categories && categories.unmatched.length > 0 ? (
        <fieldset className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface-raised px-3 py-3 text-sm">
          <legend className="sr-only">Categories</legend>
          <p className="text-ink-secondary">
            <span className="text-ink">
              {categories.unmatched.map((g) => `${g.name ?? "No category given"} (${g.count})`).join(", ")}
            </span>{" "}
            {categories.unmatched.length === 1 ? "doesn't" : "don't"} match one of your categories. Every transaction needs a
            category, so choose where each group goes. Nothing is created for you.
          </p>
          {categories.unmatched.map((g) => {
            const id = `cat-${g.key}`;
            const options = context.categories.filter((c) => c.type === g.type).sort((a, b) => a.name.localeCompare(b.name));
            return (
              <div key={g.key} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                <label htmlFor={id} className="text-ink sm:w-72">
                  Put {g.name ?? "the rows with no category"} ({g.count} {g.count === 1 ? "row" : "rows"}, {g.type === "Income" ? "income" : "spending"}) in
                </label>
                <select
                  id={id}
                  value={categoryChoice[g.key] ?? ""}
                  onChange={(e) => onCategory(g.key, e.target.value)}
                  className={`${FIELD_CLASS} sm:max-w-xs`}
                  required
                >
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
            const row = rowsByNumber.get(m.row);
            if (!row) return null;
            return (
              <fieldset key={m.row} className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface-raised px-3 py-3 text-sm">
                <legend className="sr-only">Is row {m.row} the same bill?</legend>
                <p className="flex items-start gap-2">
                  <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                  <span className="text-ink-secondary">
                    <span className="font-medium text-ink">Is this the same bill?</span> {row.description} ·{" "}
                    <Amount amount={dollars(row.cents)} type={row.type} /> · {formatDayMonth(row.date)} looks like {m.name}&apos;s{" "}
                    {formatDayMonth(m.dueDate)} payment, which is still waiting in your confirmation list.
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
