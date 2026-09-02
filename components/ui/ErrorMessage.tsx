"use client";

import { InfoIcon, WarningIcon } from "@/components/ui/icons";

export function ErrorMessage({
  message,
  severity = "notice",
  onRetry,
}: {
  message: string;
  /**
   * "notice" is the calm default -- inline form guidance, a field that
   * still needs a value. "critical" is for a genuine failure: a page that
   * couldn't load, a delete that didn't go through. Reserved status red
   * never rides along with ordinary validation, and there's no verdict
   * heading either way -- the message itself says what happened and what
   * to do next.
   */
  severity?: "notice" | "critical";
  onRetry?: () => void;
}) {
  const critical = severity === "critical";
  const Icon = critical ? WarningIcon : InfoIcon;

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
        critical ? "border-critical/30 bg-critical/10" : "border-hairline bg-surface-raised"
      }`}
    >
      <Icon
        className={`mt-0.5 h-5 w-5 shrink-0 ${critical ? "text-critical" : "text-ink-muted"}`}
        aria-hidden="true"
      />
      <p className="flex-1 text-sm text-ink">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 text-sm font-medium text-action hover:text-action-hover hover:underline"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
