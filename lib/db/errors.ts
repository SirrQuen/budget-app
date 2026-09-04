import "server-only";

// Turns a PostgREST / Postgres error into a string that's safe to show a
// user, and makes sure the ones that are our fault are never lost.
//
// Two tiers:
//
//   User-fixable -- a unique-violation "that already exists", a row that was
//   deleted out from under an edit. The user did something they can undo, so
//   they get a specific, actionable message and we log at info, not error.
//
//   Everything else -- a CHECK the form should have enforced, a dangling id,
//   an UPDATE with no filter, a missing grant, a schema mismatch, a transient
//   database failure. The user gets a calm, deliberately vague line (the guts
//   would only confuse them, and it's not their problem to solve), and the
//   FULL error goes to the server log via console.error. A programmer error
//   the user hits but we can't see afterwards is how a bug lives for months.

// Structural, so both `.from()` and `.rpc()` errors satisfy it without an
// import from the Supabase package.
export type DbError = {
  code: string;
  message: string;
  details?: string | null;
  hint?: string | null;
};

export type WriteContext =
  | "account"
  | "category"
  | "budget"
  | "goal"
  | "contribution"
  | "transaction"
  | "transfer"
  | "profile"
  | "recurring";

// 23505 unique_violation, phrased per what was being created. Every one of
// these is something the user can see and change.
const DUPLICATE: Record<WriteContext, string> = {
  account:
    "You already have an account with that name. Use a different one, or edit the account you've got.",
  category:
    "You already have a category with that name. Use a different one, or edit the existing category.",
  budget:
    "There's already a budget for that category this month. Open that one to change it.",
  goal: "You already have a goal with that name. Use a different one.",
  contribution:
    "That contribution is already recorded. Refresh the page to see the current total.",
  transaction:
    "That transaction is already logged. Refresh the page to see it in the list.",
  transfer:
    "That transfer is already logged. Refresh the page to see it in the list.",
  profile: "That username is already taken. Pick a different one.",
  recurring: "You already have a schedule set up like that. Edit the existing one instead.",
};

// SQLSTATEs where "try again in a moment" is genuine advice -- the write
// didn't land, but nothing is wrong with it or with the code.
const TRANSIENT = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "55P03", // lock_not_available
  "57014", // query_canceled -- statement timeout
  "53300", // too_many_connections
  "08000",
  "08003",
  "08006", // connection exceptions
]);

const SESSION_EXPIRED =
  "Your session's expired. Log in again to pick up where you left off.";
const GENERIC_WRITE =
  "That didn't save, and it's not something you did. Try again in a moment.";
const GENERIC_WRITE_BUSY =
  "That didn't save -- the database was busy for a moment. Try again.";

function isStaleSession(error: DbError): boolean {
  return (
    error.code === "PGRST301" ||
    error.code === "PGRST302" ||
    /jwt (expired|invalid)/i.test(error.message)
  );
}

export function describeWriteError(error: DbError, context: WriteContext): string {
  // The one error class a normal user reaches by their own action and can
  // undo. Expected, so info -- not a bug to chase.
  if (error.code === "23505") {
    console.info(`[db:${context}] duplicate rejected: ${error.message}`);
    return DUPLICATE[context];
  }

  // .single() after an UPDATE whose target no longer exists -- a concurrent
  // delete, or a second tab. The user can recover by reloading.
  if (error.code === "PGRST116") {
    console.warn(`[db:${context}] target row is gone: ${error.message}`);
    return `That ${context} isn't there anymore. Refresh the page to see the current list.`;
  }

  if (isStaleSession(error)) {
    console.warn(`[db:${context}] stale session: ${error.message}`);
    return SESSION_EXPIRED;
  }

  if (TRANSIENT.has(error.code)) {
    console.error(`[db:${context}] transient ${error.code}:`, error);
    return GENERIC_WRITE_BUSY;
  }

  // 23502 / 23503 / 23514 / 21000 / 42501 / 42703 / 42P01 / PGRST2xx and
  // anything unrecognised: a bug on our side or a bypassed client. Nothing
  // specific for the user; everything for the log.
  console.error(`[db:${context}] unhandled write error:`, error);
  return GENERIC_WRITE;
}

// A list either loads or it doesn't -- there's no user-fixable read failure.
// Always log the real error; always return the same calm line. `resource` is
// the plural noun for the message ("accounts", "budgets").
export function describeReadError(error: DbError, resource: string): string {
  if (isStaleSession(error)) {
    console.warn(`[db:read:${resource}] stale session: ${error.message}`);
    return SESSION_EXPIRED;
  }
  console.error(`[db:read:${resource}]`, error);
  return `We couldn't load your ${resource} just now. Refresh the page to try again.`;
}
