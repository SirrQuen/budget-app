import "server-only";
import { getAccount } from "@/lib/db/accounts";
import { listCategories } from "@/lib/db/categories";
import { getToday } from "@/lib/db/settings";
import { exportTransactions } from "@/lib/db/transactions";
import { buildTransactionsCsv, exportFileName, type ExportScope } from "@/lib/transactionExport";
import { listReadOptions, type TransactionFilters } from "@/lib/transactionFilters";

/**
 * THE transaction download. Settings > "Download transactions" is this with
 * no filters; the Transactions screen's Export is this with the list's
 * filters. One read (exportTransactions -> the list's filter query), one file
 * builder (BOM, CRLF, formula-injection guard), one set of headers -- so a
 * filtered file can never be built a different way from the full one.
 *
 * A read only: RLS scopes it to the signed-in person and nothing is written.
 * Returns null when the read failed; the caller sends the person back with
 * its own message rather than downloading an error page or a file that's
 * missing rows.
 */
export async function transactionsCsvResponse(filters: Partial<TransactionFilters> = {}): Promise<Response | null> {
  // listReadOptions: the list's own reading of its filters, a tile's flow
  // scope included.
  const today = await getToday();
  const options = listReadOptions(filters, today);
  const rowsPromise = exportTransactions(options);

  // The filters name the file. Names, not ids; a name that can't be read
  // just leaves that part out of the filename, never fails the download.
  const [rows, account, categories] = await Promise.all([
    rowsPromise,
    filters.accountid ? getAccount(filters.accountid) : null,
    filters.categoryid ? listCategories() : null,
  ]);
  if (rows.error !== null) return null;

  const scope: ExportScope = {
    accountName: account && account.error === null ? account.data.account_name : null,
    categoryName:
      categories && categories.error === null
        ? (categories.data.find((c) => c.id === filters.categoryid)?.category_name ?? null)
        : null,
    type: options.transaction_type ?? "",
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    q: filters.q,
    filtered: Boolean(
      filters.accountid || filters.categoryid || filters.type || filters.dateFrom || filters.dateTo || filters.q || filters.flow,
    ),
  };

  return new Response(buildTransactionsCsv(rows.data), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(today, scope)}"`,
      // Financial records: never kept by a browser or proxy cache.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
