import { type NextRequest } from "next/server";
import { getUser } from "@/lib/auth/dal";
import { getWhatIf } from "@/lib/db/dashboard";
import { parseWhatIfRequest } from "@/lib/whatIf";

// "Can I afford it?" (docs/Decide-and-Grow.md, F2). The hero's own
// projection, run again with one pretend expense (lib/whatIf.ts).
//
// POST, never GET: the amount travels in the body, because a URL ends up
// in logs (ruling on Phase 1). Route handler, not a Server Action: Next
// dispatches Server Actions one at a time per client, so a stale answer
// couldn't be dropped while typing -- here the client aborts it.
//
// Questions never write: this reads the hero's inputs and returns an
// answer. No row, no log line, no revalidation, nothing cached.
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return Response.json({ error: "Sign in to see this." }, { status: 401, headers: NO_STORE });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Expected JSON." }, { status: 415, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400, headers: NO_STORE });
  }
  const parsed = parseWhatIfRequest(body);
  if (parsed === null) {
    return Response.json({ error: "Enter an amount and a day." }, { status: 400, headers: NO_STORE });
  }

  const answer = await getWhatIf(parsed.cents, parsed.date);
  if (answer.error !== null) {
    return Response.json({ error: answer.error }, { status: 503, headers: NO_STORE });
  }
  return Response.json(answer.data, { headers: NO_STORE });
}

const NO_STORE = { "Cache-Control": "no-store" };
