"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { TransactionType, TransactionWithRelations } from "@/lib/db/transactions";
import { bulkDeleteTransactionsAction } from "@/lib/actions/transactions";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListIcon, TransferIcon, TrashIcon } from "@/components/ui/icons";
import { formatCurrency, formatDate } from "@/lib/format";
import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DeleteTransactionButton } from "./DeleteTransactionButton";
import { useOptimisticTransactions, type PendingTransaction } from "@/components/quick-add/OptimisticTransactionsContext";
import { categoryColorVar } from "@/lib/categoryOptions";

const checkboxClassName =
  "h-4 w-4 cursor-pointer rounded border-hairline bg-surface-raised accent-action outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

// Builds a /transactions?... href from the current filters plus overrides
// (e.g. a new page number) -- every filtered, paginated view is just a URL,
// so this stays the only place query strings get assembled.
function buildHref(params: SearchParams, overrides: Record<string, string>) {
  const usp = new URLSearchParams();
  const merged = {
    dateFrom: first(params.dateFrom),
    dateTo: first(params.dateTo),
    categoryid: first(params.categoryid),
    accountid: first(params.accountid),
    type: first(params.type),
    page: first(params.page),
    ...overrides,
  };
  for (const [key, value] of Object.entries(merged)) {
    if (value) usp.set(key, value);
  }
  const qs = usp.toString();
  return `/transactions${qs ? `?${qs}` : ""}`;
}

// A quick-add ghost only belongs on this exact filtered/paginated view if it
// would actually match the filters producing the real list underneath it --
// otherwise it'd show up somewhere the real row never will.
function matchesFilters(
  tx: PendingTransaction,
  filters: { dateFrom: string; dateTo: string; categoryid: string; accountid: string; type: string },
) {
  if (filters.categoryid && tx.categoryid !== filters.categoryid) return false;
  if (filters.accountid && tx.accountid !== filters.accountid) return false;
  if (filters.type && tx.transaction_type !== filters.type) return false;
  if (filters.dateFrom && tx.transaction_date < filters.dateFrom) return false;
  if (filters.dateTo && tx.transaction_date > filters.dateTo) return false;
  return true;
}

// A transfer is two rows sharing transfer_group_id -- the raw legs are what
// the server paginates and counts, but showing both would read as the same
// money moving twice (once as income, once as spending). This collapses
// each group into one merged row before render.
type TransferDisplayRow = {
  kind: "transfer";
  transferGroupId: string;
  id: string;
  transaction_date: string;
  description: string;
  amount: number;
  fromAccountName: string | null;
  toAccountName: string | null;
};

type SingleDisplayRow = { kind: "single"; tx: TransactionWithRelations };

type DisplayRow = TransferDisplayRow | SingleDisplayRow;

// Both legs are inserted in the same statement and normally land on the same
// page, but they also carry identical transaction_date/created_at -- ties
// PostgREST's range-based pagination doesn't guarantee stay together across
// a page boundary. If a leg's pair isn't in this page's data, the missing
// side falls back to "…" rather than guessing a direction.
function buildDisplayRows(transactions: TransactionWithRelations[]): DisplayRow[] {
  const rows: DisplayRow[] = [];
  const seenGroups = new Set<string>();

  for (const tx of transactions) {
    if (!tx.transfer_group_id) {
      rows.push({ kind: "single", tx });
      continue;
    }
    if (seenGroups.has(tx.transfer_group_id)) continue;
    seenGroups.add(tx.transfer_group_id);

    const legs = transactions.filter((t) => t.transfer_group_id === tx.transfer_group_id);
    const fromLeg = legs.find((t) => t.transaction_type === "Expense");
    const toLeg = legs.find((t) => t.transaction_type === "Income");

    rows.push({
      kind: "transfer",
      transferGroupId: tx.transfer_group_id,
      id: tx.id,
      transaction_date: tx.transaction_date,
      description: tx.description,
      amount: Number(tx.amount),
      fromAccountName: fromLeg?.account_name ?? null,
      toAccountName: toLeg?.account_name ?? null,
    });
  }

  return rows;
}

// What the selection bar and bulk delete need from a display row -- a stable
// key for the checkbox/shift-click order, the magnitude to add to the
// confirmation total, and either the raw id (single) or the transfer group id
// (transfer, so both legs go together).
type SelectionInfo =
  | { key: string; amount: number; transactionId: string; transferGroupId: null }
  | { key: string; amount: number; transactionId: null; transferGroupId: string };

function selectionInfoFor(row: DisplayRow): SelectionInfo {
  if (row.kind === "transfer") {
    return {
      key: `transfer:${row.transferGroupId}`,
      amount: row.amount,
      transactionId: null,
      transferGroupId: row.transferGroupId,
    };
  }
  return {
    key: `tx:${row.tx.id}`,
    amount: Number(row.tx.amount),
    transactionId: row.tx.id,
    transferGroupId: null,
  };
}

export function TransactionsList({
  transactions,
  totalCount,
  page,
  totalPages,
  pageSize,
  params,
  hasFilters,
  canLog,
}: {
  transactions: TransactionWithRelations[];
  totalCount: number;
  page: number;
  totalPages: number;
  pageSize: number;
  params: SearchParams;
  hasFilters: boolean;
  /** False when there's no active account yet -- the add-transaction form
   * isn't shown above, so the empty state has to point at /accounts. */
  canLog: boolean;
}) {
  const { pending } = useOptimisticTransactions();

  // Selection state -- keyed by selectionInfoFor's key, not raw ids, so a
  // transfer's single checkbox tracks as one entry regardless of how many
  // legs deleting it will actually remove. Reset only happens implicitly:
  // a filter/page change re-renders this component with a new `transactions`
  // prop from the server, which remounts nothing but leaves stale keys
  // harmless since selectionInfoFor is recomputed fresh from the new rows
  // and stale keys just won't match anything rendered.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastCheckedIndex, setLastCheckedIndex] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string>();
  const [isBulkDeleting, startBulkDelete] = useTransition();

  const filters = {
    dateFrom: first(params.dateFrom),
    dateTo: first(params.dateTo),
    categoryid: first(params.categoryid),
    accountid: first(params.accountid),
    type: first(params.type),
  };

  // Ghosts only ever belong on page 1 (newest-first) -- a row that hasn't
  // been saved yet has no real position on page 2+.
  const ghosts = page === 1 ? pending.filter((tx) => matchesFilters(tx, filters)) : [];

  // Computed unconditionally (before the empty-state early returns below) so
  // the hooks above stay unconditional too -- this is just array shaping,
  // cheap even when the page ends up rendering an EmptyState instead.
  const displayRows = buildDisplayRows(transactions);
  const selectionInfos = displayRows.map(selectionInfoFor);
  const selectableKeys = selectionInfos.map((info) => info.key);

  const allSelected = selectableKeys.length > 0 && selectableKeys.every((key) => selected.has(key));
  const someSelected = selected.size > 0 && !allSelected;

  const selectedInfos = selectionInfos.filter((info) => selected.has(info.key));
  // Summed in integer cents, not JS floats -- amount is exact numeric, and
  // this total is shown back to the user, so it has to match to the cent.
  const selectedTotal =
    selectedInfos.reduce((cents, info) => cents + Math.round(info.amount * 100), 0) / 100;
  const selectedTransferCount = selectedInfos.filter((info) => info.transferGroupId !== null).length;

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(selectableKeys) : new Set());
  }

  // onClick, not onChange -- a checkbox's `.checked` is already updated to
  // its new value by the time the click event fires (before change), and
  // onClick is the one that carries shiftKey. Shift-click applies that same
  // new value across the whole range since the last row clicked, matching
  // the familiar Gmail-style multi-select.
  function handleRowCheckboxClick(e: React.MouseEvent<HTMLInputElement>, index: number, key: string) {
    const checked = e.currentTarget.checked;
    setSelected((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && lastCheckedIndex !== null) {
        const [start, end] = [lastCheckedIndex, index].sort((a, b) => a - b);
        for (let i = start; i <= end; i++) {
          const rowKey = selectableKeys[i];
          if (checked) next.add(rowKey);
          else next.delete(rowKey);
        }
      } else if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
    setLastCheckedIndex(index);
  }

  function handleBulkDelete() {
    const transactionIds = selectedInfos
      .filter((info): info is Extract<SelectionInfo, { transactionId: string }> => info.transactionId !== null)
      .map((info) => info.transactionId);
    const transferGroupIds = selectedInfos
      .filter((info): info is Extract<SelectionInfo, { transferGroupId: string }> => info.transferGroupId !== null)
      .map((info) => info.transferGroupId);

    startBulkDelete(async () => {
      const result = await bulkDeleteTransactionsAction(transactionIds, transferGroupIds);
      if (result?.error) {
        setBulkError(result.error);
        return;
      }
      setSelected(new Set());
      setLastCheckedIndex(null);
      setConfirmOpen(false);
      setBulkError(undefined);
    });
  }

  if (transactions.length === 0 && ghosts.length === 0 && page > 1 && totalCount > 0) {
    return (
      <EmptyState
        icon={<ListIcon className="h-10 w-10" />}
        heading="You've gone past the last page"
        message={`These filters only match ${totalCount} transaction${totalCount === 1 ? "" : "s"}.`}
        action={
          <Link
            href={buildHref(params, { page: "1" })}
            className="rounded text-sm font-medium text-action transition-colors duration-150 hover:text-action-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Back to page 1
          </Link>
        }
      />
    );
  }

  if (transactions.length === 0 && ghosts.length === 0) {
    if (hasFilters) {
      return (
        <EmptyState
          icon={<ListIcon className="h-10 w-10" />}
          heading="Nothing matches these filters"
          message="Try a wider date range, or clear a filter to see more."
          action={
            <Link
              href="/transactions"
              className="rounded text-sm font-medium text-action transition-colors duration-150 hover:text-action-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Clear filters
            </Link>
          }
        />
      );
    }

    if (!canLog) {
      return (
        <EmptyState
          icon={<ListIcon className="h-10 w-10" />}
          heading="This is where it all shows up"
          message="Add an account first, then log a transaction against it and this list starts filling in."
          action={
            <Link
              href="/accounts"
              className="rounded text-sm font-medium text-action transition-colors duration-150 hover:text-action-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Add an account
            </Link>
          }
        />
      );
    }

    return (
      <EmptyState
        icon={<ListIcon className="h-10 w-10" />}
        heading="This is where it all shows up"
        message="Log your first transaction above and this list becomes the real story of where your money's going."
      />
    );
  }

  return (
    <>
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-hairline bg-surface-raised px-4 py-3">
          <p className="text-sm font-medium text-ink">
            {selected.size} selected
          </p>
          <div className="flex items-center gap-3">
            {bulkError ? <span className="text-sm text-critical">{bulkError}</span> : null}
            <button
              type="button"
              onClick={() => {
                setSelected(new Set());
                setLastCheckedIndex(null);
                setBulkError(undefined);
              }}
              className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
            >
              Clear
            </button>
            <Button
              type="button"
              variant="critical"
              onClick={() => setConfirmOpen(true)}
              className="inline-flex items-center gap-1.5"
            >
              <TrashIcon className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-hairline bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all visible transactions"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={(e) => toggleAll(e.target.checked)}
                  className={checkboxClassName}
                />
              </th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {ghosts.map((tx) => {
              const isError = tx.status === "error";
              return (
                <tr
                  key={tx.clientId}
                  aria-busy={tx.status === "pending"}
                  className={
                    isError
                      ? "motion-safe:animate-[row-out_400ms_ease-in_800ms_forwards] bg-critical/10"
                      : "motion-safe:animate-[row-pending-pulse_1.4s_ease-in-out_infinite] opacity-60"
                  }
                >
                  <td className="px-4 py-3" />
                  <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">
                    {formatDate(tx.transaction_date)}
                  </td>
                  <td className="px-4 py-3 text-ink">{tx.description}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2 text-ink-secondary">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: categoryColorVar(tx.category_color) }}
                        aria-hidden="true"
                      />
                      {tx.category_name ?? "Uncategorized"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">{tx.account_name ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Amount amount={tx.amount} type={tx.transaction_type} column />
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-ink-muted">
                    {isError ? "Couldn't save" : "Saving…"}
                  </td>
                </tr>
              );
            })}
            {displayRows.map((row, index) => {
              const { key } = selectionInfos[index];
              const isSelected = selected.has(key);
              const checkbox = (
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={`Select transaction: ${row.kind === "transfer" ? row.description : row.tx.description}`}
                    checked={isSelected}
                    onChange={() => {}}
                    onClick={(e) => handleRowCheckboxClick(e, index, key)}
                    className={checkboxClassName}
                  />
                </td>
              );

              if (row.kind === "transfer") {
                return (
                  <tr
                    key={`transfer-${row.transferGroupId}`}
                    className="transition-colors duration-150 hover:bg-surface-raised motion-safe:animate-[row-in_600ms_ease-out]"
                  >
                    {checkbox}
                    <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">
                      {formatDate(row.transaction_date)}
                    </td>
                    <td className="px-4 py-3 text-ink">{row.description}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2 text-ink-secondary">
                        <TransferIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        Transfer
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">
                      {row.fromAccountName ?? "…"} → {row.toAccountName ?? "…"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-medium tabular-nums text-ink">{formatCurrency(row.amount)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-3">
                        <Link
                          href={`/transactions/${row.id}/edit`}
                          className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                        >
                          Edit
                        </Link>
                        <DeleteTransactionButton
                          id={row.id}
                          description={row.description}
                          amount={row.amount}
                          transactionType="Expense"
                          transactionDate={row.transaction_date}
                          transferGroupId={row.transferGroupId}
                          redirectToList={false}
                        />
                      </div>
                    </td>
                  </tr>
                );
              }

              const tx = row.tx;
              return (
                <tr
                  key={tx.id}
                  className="transition-colors duration-150 hover:bg-surface-raised motion-safe:animate-[row-in_600ms_ease-out]"
                >
                  {checkbox}
                  <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">
                    {formatDate(tx.transaction_date)}
                  </td>
                  <td className="px-4 py-3 text-ink">{tx.description}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2 text-ink-secondary">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: categoryColorVar(tx.category_color) }}
                        aria-hidden="true"
                      />
                      {tx.category_name ?? "Uncategorized"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">{tx.account_name ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Amount amount={Number(tx.amount)} type={tx.transaction_type as TransactionType} column />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-3">
                      <Link
                        href={`/transactions/${tx.id}/edit`}
                        className="rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                      >
                        Edit
                      </Link>
                      <DeleteTransactionButton
                        id={tx.id}
                        description={tx.description}
                        amount={tx.amount}
                        transactionType={tx.transaction_type as TransactionType}
                        transactionDate={tx.transaction_date}
                        transferGroupId={tx.transfer_group_id}
                        redirectToList={false}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`Delete ${selected.size} transaction${selected.size === 1 ? "" : "s"} totalling ${formatCurrency(selectedTotal)}?`}
        description={
          selectedTransferCount === 0
            ? "This can't be undone -- these transactions will be permanently removed."
            : `This can't be undone -- these transactions will be permanently removed. ${
                selectedTransferCount === 1
                  ? "1 of these is a transfer"
                  : `${selectedTransferCount} of these are transfers`
              } — ${selectedTransferCount === 1 ? "its matching leg" : "their matching legs"} will also be deleted.`
        }
        confirmLabel={isBulkDeleting ? "Deleting…" : "Delete"}
        confirmIcon={<TrashIcon className="h-4 w-4" />}
        cancelLabel="Cancel"
        tone="critical"
        onConfirm={handleBulkDelete}
        onCancel={() => setConfirmOpen(false)}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-secondary">
        <p>
          Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalCount)} of {totalCount}
        </p>
        <div className="flex items-center gap-3">
          {page > 1 ? (
            <Link
              href={buildHref(params, { page: String(page - 1) })}
              className="rounded font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page"
            >
              Previous
            </Link>
          ) : (
            <span className="font-medium text-ink-muted opacity-50">Previous</span>
          )}
          <span className="text-ink-muted">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={buildHref(params, { page: String(page + 1) })}
              className="rounded font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page"
            >
              Next
            </Link>
          ) : (
            <span className="font-medium text-ink-muted opacity-50">Next</span>
          )}
        </div>
      </div>
    </>
  );
}
