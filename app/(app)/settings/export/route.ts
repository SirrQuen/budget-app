import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth/dal";
import { exportTransactions } from "@/lib/db/transactions";
import { getToday } from "@/lib/db/settings";
import { buildTransactionsCsv, exportFileName } from "@/lib/transactionExport";

// "Download your transactions" in Settings. A GET that only reads: RLS
// scopes exportTransactions() to the signed-in person, and nothing is
// written -- not even a log of the export. The file format, and why it's
// also the first import format, is in lib/transactionExport.ts.
//
// A failed read sends the person back to Settings, which says so beside
// the button (?export=failed), rather than downloading an error page or a
// file that's missing rows.
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const [rows, today] = await Promise.all([exportTransactions(), getToday()]);
  if (rows.error !== null) {
    return NextResponse.redirect(new URL("/settings?export=failed#your-data-heading", request.url), 303);
  }

  return new Response(buildTransactionsCsv(rows.data), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(today)}"`,
      // Financial records: never kept by a browser or proxy cache.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
