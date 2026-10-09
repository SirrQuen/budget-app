// Client-safe: app/error.tsx imports this, so no "server-only" and nothing
// node-only (lib/db/errors.ts imports node:util and can't be bundled for
// the browser).

// Every database call runs on the Next server, so a failed fetch means the
// server can't reach Supabase, not that the user is offline. Never "check
// your connection" here (docs/phase-7-findings.md, "Copy: whose connection
// failed") -- that wording belongs only to the browser-offline case in
// app/error.tsx.
export const UNREACHABLE =
  "We can't reach our servers right now. It's not you — try again in a minute.";

// In production a Server Component error reaches app/error.tsx redacted:
// no message, only `digest`. Next keeps a digest the thrown error already
// carries (app-render/create-error-handler.js: "respect the original
// digest"), so the prefix is how the boundary tells our outage apart from a
// bug. The suffix keeps each occurrence distinct for log correlation.
const DIGEST_PREFIX = "UNREACHABLE;";

export class UnreachableError extends Error {
  readonly digest: string;

  constructor(message: string) {
    super(message);
    this.name = "UnreachableError";
    this.digest = DIGEST_PREFIX + crypto.randomUUID().slice(0, 8);
  }
}

export function isUnreachableDigest(digest: string | undefined): boolean {
  return digest?.startsWith(DIGEST_PREFIX) ?? false;
}

// What app/error.tsx shows as the reference code: the digest without the
// marker, so the user never sees an internal label.
export function referenceFromDigest(digest: string): string {
  return isUnreachableDigest(digest) ? digest.slice(DIGEST_PREFIX.length) : digest;
}
