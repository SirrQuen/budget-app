"use client";

import { WarningIcon } from "@/components/ui/icons";

export function ErrorMessage({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-critical/30 bg-critical/10 px-4 py-3"
    >
      <WarningIcon className="mt-0.5 h-5 w-5 shrink-0 text-critical" aria-hidden="true" />
      <div className="flex-1">
        <p className="text-sm font-medium text-ink">Something went wrong</p>
        <p className="mt-0.5 text-sm text-ink-secondary">{message}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 text-sm font-medium text-accent hover:underline"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
