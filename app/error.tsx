"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { UNREACHABLE, isUnreachableDigest, referenceFromDigest } from "@/lib/unreachable";

// Catches anything thrown while rendering a route under app/ (not the root
// layout itself -- that would need app/global-error.tsx). Must be a Client
// Component.
//
// Next already logs the real server error, with its stack, to the server;
// what reaches this component in production is a redacted Error plus a
// `digest` that correlates to that log line. So: the user sees a calm
// generic message and a reference code, we keep the detail server-side, and
// a stack trace is never rendered.
//
// Three cases, because "whose connection failed" decides the copy
// (docs/phase-7-findings.md, "Copy: whose connection failed"):
//   - The browser is offline: a navigation or Server Action never reached
//     us. The ONLY place "check your connection" is said.
//   - The server can't reach Supabase: an UnreachableError, recognised by its
//     digest because the message is redacted in production. Not the user's
//     connection, so never "check your connection".
//   - Anything else: the generic text.

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

// The server render can't know; assume online so it never claims the user
// is offline, and let hydration correct it.
const useOnline = () =>
  useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

const OFFLINE = "You appear to be offline. Check your connection, then try again.";
const GENERIC =
  "Something on our end broke, not anything you did. Try again — if it keeps happening, give it a few minutes.";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Covers the client-thrown case and echoes the digest for correlation.
    console.error(error);
  }, [error]);

  const online = useOnline();
  const message = !online ? OFFLINE : isUnreachableDigest(error.digest) ? UNREACHABLE : GENERIC;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-page px-6 py-16 text-center text-ink">
      <div className="flex max-w-sm flex-col gap-2">
        <h1 className="text-2xl font-semibold">This page didn&rsquo;t load</h1>
        <p className="text-sm text-ink-secondary">{message}</p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center justify-center rounded-full bg-action px-4 py-2 text-sm font-semibold text-action-ink transition-all duration-150 ease-out hover:-translate-y-0.5 hover:bg-action-hover hover:shadow-md active:translate-y-0 active:scale-[0.97] active:bg-action-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-full border border-hairline px-4 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page"
        >
          Back to dashboard
        </Link>
      </div>

      {error.digest ? (
        <p className="text-xs text-ink-muted">
          Reference: <span className="font-mono">{referenceFromDigest(error.digest)}</span>
        </p>
      ) : null}
    </main>
  );
}
