import { getUser } from "@/lib/auth/dal";
import { getYourSorrel } from "@/lib/db/milestones";

// The Your Sorrel panel's dates. Read when the panel OPENS, never on a page
// load -- the dashboard itself only asks which milestones are earned (three
// queries); the dates and "with Sorrel since" cost more and are wanted rarely.
//
// GET: nothing in the request, and it only reads. No row, no revalidation,
// nothing cached.
export async function GET() {
  const user = await getUser();
  if (!user) {
    return Response.json({ error: "Sign in to see this." }, { status: 401, headers: NO_STORE });
  }
  const result = await getYourSorrel();
  if (result.error !== null) {
    return Response.json({ error: result.error }, { status: 503, headers: NO_STORE });
  }
  return Response.json(result.data, { headers: NO_STORE });
}

const NO_STORE = { "Cache-Control": "no-store" };
