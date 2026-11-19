// No "server-only": nothing here is secret, and betaApplicationErrors.test.ts
// imports it directly (as lib/db/errors.ts is). Only lib/db/betaApplications.ts,
// which is server-only, uses it.
import { classifyDbError, UNREACHABLE, type DbError } from "@/lib/db/errors";

// ---------------------------------------------------------------------
// Errors: the code, and nothing else
//
// The import rule (lib/db/imports.ts), applied to the beta application: a
// failed submit is logged by SQLSTATE CODE ONLY -- never the message,
// details or hint. Postgres puts the failing row's VALUES in the detail of
// a constraint error ("Failing row contains (..., <email>, <full name>,
// ...)"), so logDbError(), which writes the whole error, would put an
// applicant's name and email in Vercel's logs. The privacy policy says the
// application is seen only by us; a log line is not where it's kept.
//
// What the applicant is TOLD is one of three fixed sentences. Nothing
// Postgres said reaches them either.
// ---------------------------------------------------------------------

export const BETA_RATE_LIMITED =
  "A lot of people have applied in the last hour, so we've paused applications for a bit. Your answers are still here. Try again later.";
export const BETA_GENERIC =
  "We couldn't send your application just now. Your answers are still here. Try again in a moment.";

/** The log line for a failed submit: a fixed prefix and the code. */
export function betaErrorLogLine(error: DbError): string {
  const code = error.code || "none";
  if (error.code === "P0001" && error.message === "beta_rate_limited") {
    return `[db:beta] RATE LIMIT TRIPPED (code=${code}): 100 applications in the last hour; submit_beta_application() is refusing every one until the window rolls`;
  }
  return `[db:beta] submit failed (${classifyDbError(error)}), code=${code}`;
}

/**
 * Logs the code (at error level, so it shows in Vercel's runtime logs --
 * there's no error tracker) and returns what the applicant is told.
 */
export function describeBetaSubmitError(
  error: DbError,
  log: (line: string) => void = console.error,
): string {
  log(betaErrorLogLine(error));
  if (error.code === "P0001" && error.message === "beta_rate_limited") return BETA_RATE_LIMITED;
  if (classifyDbError(error) === "network-unreachable") return UNREACHABLE;
  return BETA_GENERIC;
}
