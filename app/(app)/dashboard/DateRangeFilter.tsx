"use client";

import { useId, useState } from "react";
import type { DashboardRange, DashboardRangePreset } from "@/lib/dashboardRange";
import { todayISO } from "@/lib/date";
import { ChevronDownIcon } from "@/components/ui/icons";

// Presets in the order the brief lists them; month-to-date is the default
// and carries no URL params.
const PRESETS: { preset: Exclude<DashboardRangePreset, "custom">; label: string; query: string }[] = [
  { preset: "7d", label: "7 days", query: "range=7d" },
  { preset: "30d", label: "30 days", query: "range=30d" },
  { preset: "90d", label: "90 days", query: "range=90d" },
  { preset: "mtd", label: "Month to date", query: "" },
];

const inputClass =
  "rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-action focus:ring-2 focus:ring-action/40";

export function DateRangeFilter({
  range,
  onApply,
  pending,
}: {
  range: DashboardRange;
  onApply: (query: string) => void;
  pending: boolean;
}) {
  const isCustom = range.preset === "custom";
  const [showCustom, setShowCustom] = useState(isCustom);
  const [from, setFrom] = useState(isCustom ? range.from : "");
  const [to, setTo] = useState(isCustom ? range.to : "");
  const fromId = useId();
  const toId = useId();
  const today = todayISO();

  const customValid = from !== "" && to !== "" && from <= to;

  function selectPreset(query: string) {
    setShowCustom(false);
    onApply(query);
  }

  function applyCustom() {
    if (!customValid) return;
    onApply(new URLSearchParams({ from, to }).toString());
  }

  return (
    <div
      role="group"
      aria-label="Date range"
      className="flex flex-wrap items-center gap-2 rounded-2xl border border-hairline bg-surface p-2"
    >
      {PRESETS.map((p) => {
        const selected = !showCustom && range.preset === p.preset;
        return (
          <button
            key={p.preset}
            type="button"
            aria-pressed={selected}
            disabled={pending}
            onClick={() => selectPreset(p.query)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-60 ${
              selected
                ? "bg-surface-raised text-ink"
                : "text-ink-secondary hover:text-ink"
            }`}
          >
            {p.label}
          </button>
        );
      })}

      <span aria-hidden="true" className="mx-1 h-6 w-px bg-hairline" />

      <button
        type="button"
        aria-pressed={showCustom || isCustom}
        aria-expanded={showCustom}
        disabled={pending}
        onClick={() => setShowCustom((v) => !v)}
        className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-60 ${
          showCustom || isCustom ? "bg-surface-raised text-ink" : "text-ink-secondary hover:text-ink"
        }`}
      >
        Custom
        <ChevronDownIcon
          aria-hidden="true"
          className={`h-4 w-4 text-ink-muted motion-safe:transition-transform motion-safe:duration-150 ${
            showCustom ? "rotate-180" : ""
          }`}
        />
      </button>

      {showCustom ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={fromId} className="text-xs font-medium text-ink-secondary">
              From
            </label>
            <input
              id={fromId}
              type="date"
              value={from}
              max={to || today}
              onChange={(e) => setFrom(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={toId} className="text-xs font-medium text-ink-secondary">
              To
            </label>
            <input
              id={toId}
              type="date"
              value={to}
              min={from || undefined}
              max={today}
              onChange={(e) => setTo(e.target.value)}
              className={inputClass}
            />
          </div>
          <button
            type="button"
            disabled={pending || !customValid}
            onClick={applyCustom}
            className="inline-flex items-center justify-center rounded-full bg-action px-4 py-2 text-sm font-semibold text-action-ink transition-all duration-150 ease-out hover:-translate-y-0.5 hover:bg-action-hover hover:shadow-md active:translate-y-0 active:scale-[0.97] active:bg-action-pressed active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:bg-action disabled:hover:shadow-none"
          >
            Apply
          </button>
        </div>
      ) : null}
    </div>
  );
}
