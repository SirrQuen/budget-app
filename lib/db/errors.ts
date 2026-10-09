// No "server-only": nothing here is secret, and errors.test.ts imports this
// module directly (same reasoning as lib/businessDays.ts). Only lib/db
// modules, which are server-only themselves, import it.
import util from "node:util";
import { isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";

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

// Structural, so `.from()` and `.rpc()` errors and auth-js AuthErrors (from
// getClaims) all satisfy it. `code` is optional because an AuthError's can
// be undefined, and so can a PostgREST error's when the body wasn't JSON.
export type DbError = {
  code?: string | null;
  message: string;
  details?: string | null;
  hint?: string | null;
};

export type DbErrorClass =
  | "network-unreachable"
  | "auth-expired"
  | "permission-denied"
  | "transient"
  | "not-found"
  | "unexpected";

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
// didn't land, but nothing is wrong with it or with the code. Class 08
// (connection exceptions) is matched by prefix in classifyDbError.
const TRANSIENT = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "55P03", // lock_not_available
  "57014", // query_canceled -- statement timeout
  "53300", // too_many_connections
]);

const SESSION_EXPIRED =
  "Your session's expired. Log in again to pick up where you left off.";
const GENERIC_WRITE =
  "That didn't save, and it's not something you did. Try again in a moment.";
const GENERIC_WRITE_BUSY =
  "That didn't save -- the database was busy for a moment. Try again.";
// Every database call runs on the Next server, so a failed fetch means the
// server can't reach Supabase, not that the user is offline. Never "check
// your connection" here (docs/phase-7-findings.md, "Copy: whose connection
// failed").
const UNREACHABLE =
  "We can't reach our servers right now. It's not you — try again in a minute.";

// Server Component console output is serialized on its way to the browser
// dev overlay, and an object argument to console.error arrives there as
// "{}" no matter what it contains. A string argument survives intact, so
// build one line covering every way to identify an error -- a full
// util.inspect, its String() coercion, constructor name, and own
// property/symbol names (for the exotic shapes those miss) -- and log that.
export function logDbError(prefix: string, error: unknown): void {
  const inspected = util.inspect(error, { depth: 4, showHidden: true });
  const stringified = String(error);
  const ctorName = (error as { constructor?: { name?: string } } | null)?.constructor?.name;
  const ownNames = Object.getOwnPropertyNames(error ?? {});
  const ownSymbols = Object.getOwnPropertySymbols(error ?? {}).map(String);

  const line =
    `inspect=${inspected} string=${stringified} ctor=${ctorName} ` +
    `ownNames=${JSON.stringify(ownNames)} ownSymbols=${JSON.stringify(ownSymbols)}`;

  console.error(prefix + " " + line);
}

function isStaleSession(error: DbError): boolean {
  return (
    error.code === "PGRST301" ||
    error.code === "PGRST302" ||
    /jwt (expired|invalid)/i.test(error.message)
  );
}

// The one place an error gets sorted. Both describe functions and
// sessionUserId() go through it; nothing else inspects error codes.
export function classifyDbError(error: DbError): DbErrorClass {
  // auth-js (getClaims). AuthRetryableFetchError means the auth server
  // couldn't be reached or answered 5xx; any other AuthError is a genuine
  // auth failure. Both checks are public API, so they need no pinning.
  if (isAuthRetryableFetchError(error)) return "network-unreachable";
  if (isAuthError(error)) return "auth-expired";

  // postgrest-js doesn't throw when fetch() rejects. It returns
  // { code: "", details: "...Caused by: <name>: <message> (<cause code>)" }.
  // That's an implementation detail (2.112.2, dist/index.mjs, the
  // `res.catch` in `then`), and the only path that sets code to "" -- an
  // HTTP error with a non-JSON body leaves code undefined. errors.test.ts
  // pins the shape against the real client, so an upgrade that changes it
  // fails a test instead of quietly turning every outage into "unexpected".
  if (error.code === "" && /Caused by: /.test(error.details ?? "")) {
    return "network-unreachable";
  }

  if (isStaleSession(error)) return "auth-expired";
  if (error.code === "42501") return "permission-denied";
  if (error.code && (TRANSIENT.has(error.code) || error.code.startsWith("08"))) {
    return "transient";
  }
  if (error.code === "PGRST116") return "not-found";
  return "unexpected";
}

export function describeWriteError(error: DbError, context: WriteContext): string {
  // The one error class a normal user reaches by their own action and can
  // undo. Expected, so info -- not a bug to chase. Write-only, and its copy
  // depends on context, so it's checked here rather than classified.
  if (error.code === "23505") {
    console.info(`[db:${context}] duplicate rejected: ${error.message}`);
    return DUPLICATE[context];
  }

  const kind = classifyDbError(error);
  switch (kind) {
    // .single() after an UPDATE whose target no longer exists -- a
    // concurrent delete, or a second tab. The user can recover by reloading.
    case "not-found":
      console.warn(`[db:${context}] target row is gone: ${error.message}`);
      return `That ${context} isn't there anymore. Refresh the page to see the current list.`;
    case "auth-expired":
      console.warn(`[db:${context}] stale session: ${error.message}`);
      return SESSION_EXPIRED;
    case "network-unreachable":
      logDbError(`[db:${context}] network-unreachable:`, error);
      return UNREACHABLE;
    case "transient":
      logDbError(`[db:${context}] transient ${error.code}:`, error);
      return GENERIC_WRITE_BUSY;
    // permission-denied (42501) is a GRANT or policy bug, never the user's
    // to fix. unexpected covers 23502 / 23503 / 23514 / 21000 / 42703 /
    // 42P01 / PGRST2xx and anything unrecognised: a bug on our side or a
    // bypassed client. Nothing specific for the user; everything for the log.
    case "permission-denied":
    case "unexpected":
      logDbError(`[db:${context}] ${kind} write error:`, error);
      return GENERIC_WRITE;
  }
}

// A list either loads or it doesn't -- there's no user-fixable read failure.
// Always log the real error. `resource` is the plural noun for the message
// ("accounts", "budgets").
export function describeReadError(error: DbError, resource: string): string {
  const kind = classifyDbError(error);
  switch (kind) {
    case "auth-expired":
      console.warn(`[db:read:${resource}] stale session: ${error.message}`);
      return SESSION_EXPIRED;
    case "network-unreachable":
      logDbError(`[db:read:${resource}] network-unreachable:`, error);
      return UNREACHABLE;
    case "transient":
      logDbError(`[db:read:${resource}] transient ${error.code}:`, error);
      return `We couldn't load your ${resource} -- the database was busy for a moment. Refresh the page to try again.`;
    case "permission-denied":
    case "not-found":
    case "unexpected":
      logDbError(`[db:read:${resource}] ${kind}:`, error);
      return `We couldn't load your ${resource} just now. Refresh the page to try again.`;
  }
}

// What supabase.auth.getClaims() resolves to, structurally.
type ClaimsResult = {
  data: { claims: { sub?: string } } | null;
  error: DbError | null;
};

// The session check every write makes before it inserts: the userid from
// the verified JWT, or the message to show instead. `context` labels the log.
//   const session = sessionUserId(await supabase.auth.getClaims(), "account");
export function sessionUserId(
  result: ClaimsResult,
  context: string,
): { userid: string; error: null } | { userid: null; error: string } {
  const userid = result.data?.claims?.sub;
  if (!result.error) {
    // No session at all: getClaims resolves { data: null, error: null }.
    return userid ? { userid, error: null } : { userid: null, error: SESSION_EXPIRED };
  }

  const kind = classifyDbError(result.error);
  switch (kind) {
    case "auth-expired":
      console.warn(`[db:${context}] stale session: ${result.error.message}`);
      return { userid: null, error: SESSION_EXPIRED };
    case "network-unreachable":
      logDbError(`[db:${context}] session check network-unreachable:`, result.error);
      return { userid: null, error: UNREACHABLE };
    default:
      logDbError(`[db:${context}] session check ${kind}:`, result.error);
      return { userid: null, error: GENERIC_WRITE };
  }
}
