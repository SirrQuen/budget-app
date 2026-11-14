import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth/dal";
import { transactionsCsvResponse } from "@/lib/exportResponse";
import { buildListHref, parseTransactionFilters } from "@/lib/transactionFilters";

// "Export" on the Transactions screen: exactly what the list's filters
// select, every matching row (not the page), as a CSV. The filters arrive
// as the list's own query string and are parsed by the list's own parser
// (parseTransactionFilters), then read through the list's own filter query
// (lib/db/transactions.ts selectFiltered). A GET that only reads.
//
// A failed read sends the person back to the same filtered list, which says
// so (?export=failed).
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const filters = parseTransactionFilters(Object.fromEntries(request.nextUrl.searchParams));
  const response = await transactionsCsvResponse(filters);
  if (response === null) {
    const back = buildListHref("/transactions", filters);
    return NextResponse.redirect(new URL(`${back}${back.includes("?") ? "&" : "?"}export=failed`, request.url), 303);
  }
  return response;
}
