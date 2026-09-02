"use client";

import Link from "next/link";
import { useEffect } from "react";

// Catches anything thrown while rendering a route under app/ (not the root
// layout itself -- that would need app/global-error.tsx). Must be a Client
// Component.
//
// Next already logs the real server error, with its stack, to the server;
// what reaches this component in production is a redacted Error plus a
// `digest` that correlates to that log line. So: the user sees a calm
// generic message and a reference code, we keep the detail server-side, and
// a stack trace is never rendered.
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

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-page px-6 py-16 text-center text-ink">
      <div className="flex max-w-sm flex-col gap-2">
        <h1 className="text-2xl font-semibold">This page didn&rsquo;t load</h1>
        <p className="text-sm text-ink-secondary">
          Something on our end broke, not anything you did. Try again — if it keeps happening,
          give it a few minutes.
        </p>
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
          Reference: <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
    </main>
  );
}
