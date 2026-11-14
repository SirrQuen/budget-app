import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth/dal";
import { transactionsCsvResponse } from "@/lib/exportResponse";

// "Download your transactions" in Settings: the Transactions screen's export
// with no filters (lib/exportResponse.ts). A GET that only reads. The file
// format, and why it's also the first import format, is in
// lib/transactionExport.ts.
//
// A failed read sends the person back to Settings, which says so beside
// the button (?export=failed), rather than downloading an error page or a
// file that's missing rows.
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const response = await transactionsCsvResponse();
  if (response === null) {
    return NextResponse.redirect(new URL("/settings?export=failed#your-data-heading", request.url), 303);
  }
  return response;
}
